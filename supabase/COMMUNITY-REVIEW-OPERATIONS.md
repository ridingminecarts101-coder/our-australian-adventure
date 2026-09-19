# Community review email operations

The notification worker sends consented, text-only submission snapshots to
`help.rlapplications@gmail.com`. Photos stay on the device. It cannot approve a
post. The separately scheduled reviewer uses the current database revision and
the protected `review_community_recommendation(uuid,bigint,text,text)` function.

Notification emails include optional Approve and Reject buttons. Clicking only
composes a draft addressed to the support mailbox. The owner replaces the reason
placeholder and sends **from that same mailbox**. These are instructions for the
next successful review run, not immediate website actions. A rejection reason is
visible to the author in Wayfinder. The owner can invite changes/resubmission in
that reason; the reviewer must not rewrite the author's post.

## Owner-command verification

Use `tools/community_owner_decision.mjs --gmail` with JSON on stdin containing
`profile` and `message`, taken from the authenticated Gmail connector's structured
responses. `profile.email` establishes the connected mailbox independently of
the message headers. The adapter checks unique top-level identity headers, the
actual Gmail SENT system label, recipient, attachments, MIME structure, exact
command syntax and UUID/revision/reason. It returns the parsed command or `null`;
it never executes a decision. Do not construct commands from quoted email text,
HTML, inbound From headers or search results. Never have the reviewer send its
own owner-command email.

After parsing, recheck current pending status, consent, revision and reports;
check source evidence and safety; use the unchanged protected function; then
verify status, visibility and its matching audit entry. Stale/decided commands
must not be forced through or used to change a completed decision. Reports and
appeals retain separate human review. No client or mail-worker grant is added.

## Inbox reconciliation and coverage

The database is authoritative. A delivered email left in INBOX may already be
actioned. Verified completed notifications and support-only outcome receipts use
`Wayfinder/Actioned` and are archived. Superseded/deleted revisions use
`Wayfinder/Stale`. Actual human holds remain in INBOX with
`Wayfinder/Needs review`, a specific explanation and the same action buttons.
Use exact message IDs, never alter unrelated messages or delete mail. Failed
processing remains visible as `Wayfinder/Automation issue`.

The live notifier is scheduled every five minutes, one lease per invocation and
at most 50 send attempts per UTC day. The desktop reviewer runs hourly, up to five
actionable revisions, and requires the PC/Codex and authenticated connections to
be available. It is not a continuous cloud moderation service. Skip unchanged
held cases after escalation so they do not block newer work. Monitor failed or
aged delivery, expired leases, exhausted budget with backlog, and access/privacy
failures. Provider acceptance and cron SQL success alone do not prove delivery.
Terminal outbox failures require an operator investigation, not a blind reset of
attempts or an idempotency key change.

Keep customer prose out of source control and development records. Use the fresh
moderation task created after training opt-out. Store only minimal opaque
ID/revision/message-ID receipts in its protected local directory; remove
temporary body-containing parser input. The operator workflow and scheduler
configuration are managed separately from this source tree.

Run `node tools/test_community_review_notifier.mjs`,
`node tools/test_community_owner_decision.mjs`, and
`node tools/test_community_email_review.mjs` for the mail, command and database
security contracts. The owner-command tests also run in `npm run check`.
