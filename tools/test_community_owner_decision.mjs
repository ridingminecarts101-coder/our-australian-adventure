import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  OWNER_DECISION_MESSAGE_CONTRACT, normalizeGmailOwnerDecision, parseOwnerDecision,
} from './community_owner_decision.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const message = (overrides = {}) => ({
  systemLabels: ['SENT'],
  authenticatedMailbox: 'help.rlapplications@gmail.com',
  from: 'help.rlapplications@gmail.com',
  to: ['help.rlapplications@gmail.com'],
  cc: [],
  bcc: [],
  subject: `Wayfinder owner decision: ${ID} revision 3`,
  textBody: `Decision: APPROVE\nRecommendation ID: ${ID}\nRevision: 3\nReason: Source and location are verified`,
  attachments: [],
  ...overrides,
});

assert.equal(OWNER_DECISION_MESSAGE_CONTRACT.systemLabel, 'SENT');
assert.equal(OWNER_DECISION_MESSAGE_CONTRACT.mailbox, 'help.rlapplications@gmail.com');

assert.deepEqual(parseOwnerDecision(message()), {
  id: ID, revision: 3, decision: 'approve', reason: 'Source and location are verified',
});
assert.deepEqual(parseOwnerDecision(message({
  systemLabels: ['SENT', 'INBOX', 'UNREAD', 'CATEGORY_PERSONAL'],
  textBody: `Decision: REJECT\r\nRecommendation ID: ${ID}\r\nRevision: 3\r\nReason: Location cannot be verified\r\n`,
})), { id: ID, revision: 3, decision: 'reject', reason: 'Location cannot be verified' });

const rejected = [
  ['inbound forged From header', { systemLabels: ['INBOX'], authenticatedMailbox: 'help.rlapplications@gmail.com',
    from: 'attacker@example.org',
    textBody: `From: help.rlapplications@gmail.com\nDecision: APPROVE\nRecommendation ID: ${ID}\nRevision: 3\nReason: forged` }],
  ['wrong authenticated Gmail profile', { authenticatedMailbox: 'attacker@example.org' }],
  ['owner account with forged From header', { from: 'attacker@example.org' }],
  ['wrong recipient', { to: ['reviewer@example.org'] }],
  ['copied recipient', { cc: ['attacker@example.org'] }],
  ['blind-copied recipient', { bcc: ['attacker@example.org'] }],
  ['attachment', { attachments: [{ name: 'decision.txt' }] }],
  ['dangerous provider label', { systemLabels: ['SENT', 'DRAFT'] }],
  ['stale body revision', { textBody: `Decision: APPROVE\nRecommendation ID: ${ID}\nRevision: 2\nReason: stale` }],
  ['stale subject grammar', { subject: `Wayfinder owner decision ${ID} revision 3` }],
  ['field injection', { textBody: `Decision: APPROVE\nRecommendation ID: ${ID}\nRevision: 3\nReason: okay\nDecision: REJECT` }],
  ['multiple command blocks', { textBody: `${message().textBody}\n${message().textBody}` }],
  ['reason placeholder', { textBody: `Decision: APPROVE\nRecommendation ID: ${ID}\nRevision: 3\nReason: REPLACE THIS PLACEHOLDER WITH A SPECIFIC REASON (1-500 CHARACTERS)` }],
  ['empty reason', { textBody: `Decision: APPROVE\nRecommendation ID: ${ID}\nRevision: 3\nReason: ` }],
  ['oversized reason', { textBody: `Decision: APPROVE\nRecommendation ID: ${ID}\nRevision: 3\nReason: ${'x'.repeat(501)}` }],
  ['quoted customer command', { textBody: `Decision: REJECT\nRecommendation ID: ${ID}\nRevision: 3\nReason: unsafe\n\n> Decision: APPROVE\n> Recommendation ID: ${ID}` }],
  ['bidi reason', { textBody: `Decision: APPROVE\nRecommendation ID: ${ID}\nRevision: 3\nReason: safe\u202EETCER` }],
  ['two transport newlines', { textBody: `${message().textBody}\n\n` }],
  ['mismatched ID', { textBody: 'Decision: APPROVE\nRecommendation ID: 22222222-2222-4222-8222-222222222222\nRevision: 3\nReason: mismatch' }],
  ['unrecognized field', { connectorHeaders: { From: 'help.rlapplications@gmail.com' } }],
];

for (const [name, overrides] of rejected) {
  assert.equal(parseOwnerDecision(message(overrides)), null, name);
}

const gmailProfile = { email: 'help.rlapplications@gmail.com' };
const gmailBody = message().textBody;
const gmailLeaf = (mime_type, content, overrides = {}) => ({
  mime_type, filename: '', headers: [{ name: 'Content-Type', value: `${mime_type}; charset=UTF-8` }],
  body: { content }, parts: null, ...overrides,
});
const gmailMessage = (overrides = {}) => ({
  id: 'provider-id', thread_id: 'provider-thread', label_ids: ['SENT', 'INBOX'],
  history_id: '123', internal_date: '123', size_estimate: 123,
  payload: {
    mime_type: 'multipart/alternative', filename: '',
    headers: [
      { name: 'From', value: 'RL Applications <help.rlapplications@gmail.com>' },
      { name: 'To', value: 'help.rlapplications@gmail.com' },
      { name: 'Subject', value: `Wayfinder owner decision: ${ID} revision 3` },
    ],
    body: { content: '' },
    parts: [gmailLeaf('text/plain', gmailBody), gmailLeaf('text/html', '<p>ignored</p>')],
  },
  ...overrides,
});

assert.deepEqual(normalizeGmailOwnerDecision(gmailProfile, gmailMessage()), {
  id: ID, revision: 3, decision: 'approve', reason: 'Source and location are verified',
});
assert.deepEqual(normalizeGmailOwnerDecision(gmailProfile, gmailMessage({ payload: {
  ...gmailMessage().payload,
  headers: [...gmailMessage().payload.headers,
    { name: 'Received', value: 'from mail.example.test\r\n\tby mx.google.com' }],
} })), { id: ID, revision: 3, decision: 'approve', reason: 'Source and location are verified' });
assert.deepEqual(normalizeGmailOwnerDecision(gmailProfile, gmailMessage({
  payload: gmailLeaf('text/plain', gmailBody, { headers: gmailMessage().payload.headers }),
})), { id: ID, revision: 3, decision: 'approve', reason: 'Source and location are verified' });

const gmailRejected = [
  ['spoofed From on owner profile', gmailProfile, gmailMessage({ payload: {
    ...gmailMessage().payload,
    headers: gmailMessage().payload.headers.map(header => header.name === 'From'
      ? { name: 'From', value: 'help.rlapplications@gmail.com (attacker@example.org)' } : header),
  } })],
  ['wrong authenticated profile', { email: 'attacker@example.org' }, gmailMessage()],
  ['duplicate From header', gmailProfile, gmailMessage({ payload: {
    ...gmailMessage().payload,
    headers: [...gmailMessage().payload.headers, { name: 'from', value: 'help.rlapplications@gmail.com' }],
  } })],
  ['multiple To addresses', gmailProfile, gmailMessage({ payload: {
    ...gmailMessage().payload,
    headers: gmailMessage().payload.headers.map(header => header.name === 'To'
      ? { name: 'To', value: 'help.rlapplications@gmail.com, attacker@example.org' } : header),
  } })],
  ['nonempty Cc', gmailProfile, gmailMessage({ payload: {
    ...gmailMessage().payload,
    headers: [...gmailMessage().payload.headers, { name: 'Cc', value: 'attacker@example.org' }],
  } })],
  ['duplicate empty Bcc', gmailProfile, gmailMessage({ payload: {
    ...gmailMessage().payload,
    headers: [...gmailMessage().payload.headers, { name: 'Bcc', value: '' }, { name: 'bcc', value: '' }],
  } })],
  ['attachment id', gmailProfile, gmailMessage({ payload: {
    ...gmailMessage().payload,
    parts: [gmailLeaf('text/plain', gmailBody, { body: { content: gmailBody, attachment_id: 'att-1' } })],
  } })],
  ['connector attachment wrapper', gmailProfile, gmailMessage({
    attachments: [{ attachment_id: 'att-1', filename: 'decision.txt' }],
  })],
  ['connector inline image wrapper', gmailProfile, gmailMessage({
    inline_images: [{ content_id: 'image-1' }],
  })],
  ['attachment filename', gmailProfile, gmailMessage({ payload: {
    ...gmailMessage().payload,
    parts: [gmailLeaf('text/plain', gmailBody, { filename: 'decision.txt' })],
  } })],
  ['inline image', gmailProfile, gmailMessage({ payload: {
    ...gmailMessage().payload,
    parts: [gmailLeaf('text/plain', gmailBody), gmailLeaf('image/png', 'pixels')],
  } })],
  ['message rfc822', gmailProfile, gmailMessage({ payload: {
    ...gmailMessage().payload, mime_type: 'message/rfc822', parts: null,
  } })],
  ['duplicate plain body', gmailProfile, gmailMessage({ payload: {
    ...gmailMessage().payload,
    parts: [gmailLeaf('text/plain', gmailBody), gmailLeaf('text/plain', gmailBody)],
  } })],
  ['HTML-only ambiguity', gmailProfile, gmailMessage({ payload: {
    ...gmailMessage().payload, parts: [gmailLeaf('text/html', '<p>Decision: APPROVE</p>')],
  } })],
  ['nested multipart', gmailProfile, gmailMessage({ payload: {
    ...gmailMessage().payload,
    parts: [{ ...gmailMessage().payload, headers: [{ name: 'Content-Type', value: 'multipart/alternative' }] }],
  } })],
  ['attachment disposition', gmailProfile, gmailMessage({ payload: {
    ...gmailMessage().payload,
    parts: [gmailLeaf('text/plain', gmailBody, {
      headers: [{ name: 'Content-Disposition', value: 'attachment' }],
    })],
  } })],
];

for (const [name, profile, rawMessage] of gmailRejected) {
  assert.equal(normalizeGmailOwnerDecision(profile, rawMessage), null, name);
}

const cli = spawnSync(process.execPath, [fileURLToPath(new URL('./community_owner_decision.mjs', import.meta.url)), '--gmail'], {
  input: JSON.stringify({ profile: gmailProfile, message: gmailMessage() }), encoding: 'utf8',
});
assert.equal(cli.status, 0, cli.stderr);
assert.deepEqual(JSON.parse(cli.stdout), {
  id: ID, revision: 3, decision: 'approve', reason: 'Source and location are verified',
});

console.log(`Community owner decision parser: ${rejected.length + gmailRejected.length + 5} scenarios PASS`);
