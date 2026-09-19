export const COMMUNITY_OWNER_MAILBOX = 'help.rlapplications@gmail.com';
export const OWNER_DECISION_REASON_PLACEHOLDER =
  'REPLACE THIS PLACEHOLDER WITH A SPECIFIC REASON (1-500 CHARACTERS)';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function ownerDecisionSubject(id, revision) {
  if (!UUID.test(id) || !Number.isSafeInteger(revision) || revision < 1) {
    throw new TypeError('Invalid owner-decision identity');
  }
  return `Wayfinder owner decision: ${id} revision ${revision}`;
}

function mailto(id, revision, decision) {
  const body = [
    `Decision: ${decision}`,
    `Recommendation ID: ${id}`,
    `Revision: ${revision}`,
    `Reason: ${OWNER_DECISION_REASON_PLACEHOLDER}`,
  ].join('\r\n');
  return `mailto:${COMMUNITY_OWNER_MAILBOX}?subject=${encodeURIComponent(ownerDecisionSubject(id, revision))}`
    + `&body=${encodeURIComponent(body)}`;
}

/**
 * Returns fixed, safe email fragments for a human-needed owner decision.
 * The URLs contain only the UUID, revision and fixed grammar; customer content
 * and credentials are never accepted. The buttons only compose email drafts.
 */
export function ownerDecisionActions(id, revision) {
  const approveUrl = mailto(id, revision, 'APPROVE');
  const rejectUrl = mailto(id, revision, 'REJECT');
  const notice = 'After reviewing, the optional Approve and Reject buttons only compose a draft. Replace the Reason placeholder. Keep only the four draft lines and remove any email signature. Then send the message from help.rlapplications@gmail.com. The next scheduled reviewer applies a decision only after checking the fresh revision, consent, source evidence, and safety state. Stale decisions are ignored. A rejection reason is shown in the app.';
  return {
    text: `${notice}\n\nCompose APPROVE decision: ${approveUrl}\nCompose REJECT decision: ${rejectUrl}`,
    html: `<p>${escapeHtml(notice)}</p>`
      + `<p><a href="${escapeHtml(approveUrl)}" style="display:inline-block;padding:10px 16px;margin-right:8px;background:#176b3a;color:#fff;text-decoration:none;border-radius:4px">Approve</a>`
      + `<a href="${escapeHtml(rejectUrl)}" style="display:inline-block;padding:10px 16px;background:#9f2424;color:#fff;text-decoration:none;border-radius:4px">Reject</a></p>`,
  };
}
