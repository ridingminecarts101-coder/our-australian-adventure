#!/usr/bin/env node

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  COMMUNITY_OWNER_MAILBOX as OWNER_MAILBOX,
  OWNER_DECISION_REASON_PLACEHOLDER as PLACEHOLDER,
} from '../supabase/functions/_shared/community-owner-actions.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECT = /^Wayfinder owner decision: ([0-9a-f-]+) revision ([1-9][0-9]*)$/i;

export const OWNER_DECISION_MESSAGE_CONTRACT = Object.freeze({
  version: 1,
  fields: Object.freeze([
    'systemLabels', 'authenticatedMailbox', 'from', 'to', 'cc', 'bcc', 'subject', 'textBody', 'attachments',
  ]),
  systemLabel: 'SENT',
  mailbox: OWNER_MAILBOX,
  bodyFormat: 'Decision: APPROVE|REJECT\\nRecommendation ID: UUID\\nRevision: N\\nReason: 1-500 characters',
});

/**
 * Normalized message contract (independent of any Gmail connector shape):
 * {
 *   systemLabels: string[],       // unmodified Gmail label_ids; must include SENT
 *   authenticatedMailbox: string,// Gmail profile/account identity, never a header
 *   from: string,                 // sole, decoded top-level MIME From mailbox
 *   to: string[], cc: string[], bcc: string[],
 *   subject: string,
 *   textBody: string,             // decoded text/plain body only
 *   attachments: unknown[]
 * }
 *
 * Callers must normalize provider data into this shape. Header text inside the
 * body is never identity evidence. This function only parses and validates; it
 * performs no database lookup, moderation action, or network request.
 *
 * @returns {{id:string, revision:number, decision:'approve'|'reject', reason:string}|null}
 */
export function parseOwnerDecision(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const keys = Object.keys(message).sort();
  const expectedKeys = ['attachments', 'authenticatedMailbox', 'bcc', 'cc', 'from', 'subject', 'systemLabels', 'textBody', 'to'];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return null;
  if (!Array.isArray(message.systemLabels)
      || !message.systemLabels.includes('SENT')
      || message.systemLabels.some(label => ['DRAFT', 'TRASH', 'SPAM'].includes(label))) return null;
  if (message.authenticatedMailbox !== OWNER_MAILBOX || message.from !== OWNER_MAILBOX
      || !Array.isArray(message.to) || message.to.length !== 1 || message.to[0] !== OWNER_MAILBOX
      || !Array.isArray(message.cc) || message.cc.length !== 0
      || !Array.isArray(message.bcc) || message.bcc.length !== 0
      || !Array.isArray(message.attachments) || message.attachments.length !== 0
      || typeof message.subject !== 'string' || typeof message.textBody !== 'string') return null;

  const subject = SUBJECT.exec(message.subject);
  if (!subject || !UUID.test(subject[1])) return null;
  const id = subject[1].toLowerCase();
  const revision = Number(subject[2]);
  if (!Number.isSafeInteger(revision) || revision < 1) return null;

  let body = message.textBody.replaceAll('\r\n', '\n');
  if (body.endsWith('\n')) body = body.slice(0, -1);
  if (body.includes('\r') || body.endsWith('\n')) return null;
  const match = /^Decision: (APPROVE|REJECT)\nRecommendation ID: ([0-9A-Fa-f-]+)\nRevision: ([1-9][0-9]*)\nReason: ([^\n]{1,500})$/.exec(body);
  if (!match || !UUID.test(match[2])) return null;
  const bodyId = match[2].toLowerCase();
  const bodyRevision = Number(match[3]);
  const reason = match[4];
  if (!Number.isSafeInteger(bodyRevision) || bodyRevision < 1
      || bodyId !== id || bodyRevision !== revision
      || reason !== reason.trim() || reason === PLACEHOLDER
      || /[\p{Cc}\p{Cf}]/u.test(reason)) return null;

  return { id, revision, decision: match[1].toLowerCase(), reason };
}

function uniqueHeader(headers, name, { optionalEmpty = false } = {}) {
  const matches = headers.filter(header => header.name.toLowerCase() === name.toLowerCase());
  if (optionalEmpty) return matches.length === 0 || (matches.length === 1 && matches[0].value === '') ? '' : null;
  return matches.length === 1 && !/[\r\n]/.test(matches[0].value) ? matches[0].value : null;
}

function ownerMailboxHeader(value) {
  if (value === OWNER_MAILBOX) return OWNER_MAILBOX;
  const match = /^([A-Za-z0-9][A-Za-z0-9 .'-]{0,98}) <(help\.rlapplications@gmail\.com)>$/.exec(value);
  if (!match || match[1].endsWith(' ')) return null;
  return match[2];
}

function safePayloadNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)
      || typeof node.mime_type !== 'string' || node.filename !== ''
      || !Array.isArray(node.headers) || !node.body || typeof node.body !== 'object'
      || Array.isArray(node.body)) return false;
  if (node.headers.some(header => !header || typeof header.name !== 'string'
      || typeof header.value !== 'string' || /[\r\n]/.test(header.name))) return false;
  if (node.headers.some(header => {
    const name = header.name.toLowerCase();
    const unfolded = header.value.replace(/\r?\n[ \t]+/g, ' ');
    return name === 'content-id'
      || (name === 'content-disposition'
        && (/\r(?!\n[ \t])|\n(?![ \t])/.test(header.value)
          || /(?:^|;)\s*(?:attachment|inline)\b/i.test(unfolded)));
  })) return false;
  const attachmentId = node.body.attachment_id;
  return attachmentId === undefined || attachmentId === null || attachmentId === '';
}

function gmailPlainText(payload) {
  if (!safePayloadNode(payload)) return null;
  if (payload.mime_type === 'text/plain') {
    if (payload.parts !== null || typeof payload.body.content !== 'string') return null;
    return payload.body.content;
  }
  if (payload.mime_type !== 'multipart/alternative' || !Array.isArray(payload.parts)
      || payload.parts.length < 1 || payload.parts.length > 2
      || ![undefined, null, ''].includes(payload.body.content)) return null;

  let plain = null, htmlCount = 0;
  for (const part of payload.parts) {
    if (!safePayloadNode(part) || part.parts !== null || typeof part.body.content !== 'string') return null;
    if (part.mime_type === 'text/plain') {
      if (plain !== null) return null;
      plain = part.body.content;
    } else if (part.mime_type === 'text/html') htmlCount++;
    else return null;
  }
  if (plain === null || htmlCount > 1) return null;
  return plain;
}

/**
 * Validates the documented Gmail connector profile/message shape and parses a
 * decision. profile.email is account identity; MIME headers never establish it.
 * From, To and Subject must each be unique top-level structured headers. Only a
 * text/plain root or one shallow multipart/alternative plain+optional-html body
 * is accepted. HTML is ignored and attachments/nested MIME are rejected.
 *
 * @returns {{id:string, revision:number, decision:'approve'|'reject', reason:string}|null}
 */
export function normalizeGmailOwnerDecision(profile, message) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)
      || profile.email !== OWNER_MAILBOX
      || !message || typeof message !== 'object' || Array.isArray(message)
      || !Array.isArray(message.label_ids) || message.label_ids.some(label => typeof label !== 'string')
      || (message.attachments !== undefined && message.attachments !== null
        && (!Array.isArray(message.attachments) || message.attachments.length !== 0))
      || (message.inline_images !== undefined && message.inline_images !== null
        && (!Array.isArray(message.inline_images) || message.inline_images.length !== 0))
      || !message.payload
      || !safePayloadNode(message.payload)) return null;
  const headers = message.payload.headers;
  const from = uniqueHeader(headers, 'From');
  const to = uniqueHeader(headers, 'To');
  const subject = uniqueHeader(headers, 'Subject');
  if (from === null || to === null || subject === null
      || uniqueHeader(headers, 'Cc', { optionalEmpty: true }) === null
      || uniqueHeader(headers, 'Bcc', { optionalEmpty: true }) === null) return null;
  const fromMailbox = ownerMailboxHeader(from);
  const toMailbox = ownerMailboxHeader(to);
  const textBody = gmailPlainText(message.payload);
  if (!fromMailbox || !toMailbox || textBody === null) return null;
  return parseOwnerDecision({
    systemLabels: [...message.label_ids], authenticatedMailbox: profile.email,
    from: fromMailbox, to: [toMailbox], cc: [], bcc: [], subject, textBody, attachments: [],
  });
}

async function runCli() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--gmail')) throw new Error('invalid_arguments');
    const parsed = JSON.parse(input);
    const result = args[0] === '--gmail'
      ? normalizeGmailOwnerDecision(parsed?.profile, parsed?.message)
      : parseOwnerDecision(parsed);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result === null) process.exitCode = 1;
  } catch {
    process.stdout.write('null\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
