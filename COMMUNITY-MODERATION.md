# Wayfinder Community moderation — operator runbook

15 September 2026. `supabase/schema-community-hardening.sql` and `schema-community-premoderation.sql` are deployed. Live checks confirm authors cannot approve/unhide posts or call the trigger function directly. A rollback-only production test passed owner-pending visibility, outsider isolation, operator approval, author-edit requeue and separate reported-content adjudication. The aligned client is prepared for PWA v59 and the first TestFlight upload. The owner requests Codex-assisted moderation through the support Gmail; that mailbox connection is verified, but automatic post triage, approval operations and response coverage still need to be established before public launch.

## Gate and visibility after the migration

- Every new recommendation and every author content edit begins `moderation_status = 'pending'`, `approved_at = null`, `hidden = true`. A pending post is visible only to its author, not to the public feed. A database trigger forces this even when a client tries to set visibility; authenticated users receive only content-column write grants. A future broad grant is also checked by the trigger.
- The first migration run places **all existing recommendations** in pending/hidden status for operator review. A migration ledger entry makes replay idempotent so it does not re-hide later approved content. This is a real content cutover; review the existing queue before promising immediate public visibility.
- Report and Block remain available. Three reports independently hold a post hidden. An approval of content with three or more reports must remain hidden first, followed by a separate operator adjudication before an explicit unhide. An author edit always returns an approved post to pending without erasing a report hold.
- The customer-facing app shows “Awaiting operator review. Only you can see it” to the author. No client approval RPC or privileged service-role key is added. Only a protected Supabase SQL Editor session running as `postgres` or `supabase_admin` may approve or unhide.

Apple [App Review Guideline 1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content) also requires reports with timely responses, blocking and published contact. The deployed gate prevents unreviewed publication. Gmail access alone does not read or approve the Supabase queue; an operating review workflow, response coverage and mailbox receipt test remain release gates. If automation is unavailable, posts remain private.

## Safe daily operator checklist to assign

The owner must nominate a moderator and backup, how often the queue and support mailbox are checked, response targets, urgent escalation, written allowed-content standards, and a private decision-log retention rule. Until those assignments are confirmed, use this checklist as a proposed process, not a claim of operational coverage.

1. In an authorised SQL Editor session, inspect pending posts and all new reports. Review title, place, description, reason and relevant context; do not export reporter IDs or copied personal text into public files. Check the support mailbox for Community reports and privacy/deletion requests. Prioritise threats, sexual content, harassment, exposed personal data, scams and unsafe advice.
2. Record each post ID, received time, reviewer, reason category and decision in a **private** operator log. Review the content before approving; an automatic three-report hold cannot decide whether a post is safe. Do not approve merely to clear a queue.
3. Approve clean pending content only from the SQL Editor. When `report_count < 3`, set `moderation_status = 'approved', hidden = false` for the exact reviewed ID; the trigger supplies `approved_at = now()`. When `report_count >= 3`, approve with `hidden = true` first. After separately reviewing the reports and recording the adjudication, an operator may explicitly set `hidden = false` on that already approved row. Never combine approval and unhide for a three-report hold.
4. Keep unsafe or unresolved posts hidden. Remove confirmed violations through the protected operator route after recording minimum decision evidence: deletion cascades dependent votes and reports. Escalate repeat abuse under the owner-approved standard; do not grant a mobile client broad update rights.
5. Respond to the reporter or affected user through the staffed support route within the owner-approved target, without disclosing another user's private information. Record follow-up, appeal and closure so a backup reviewer can take over. Verify the published contact route actually receives a safe test message. The Resend no-reply transactional sender is separate.

### SQL Editor pattern for an exact reviewed ID

Run only after confirming the protected SQL Editor is using its privileged operator role. Replace the placeholder UUID with the exact post ID obtained in that session; read the content and reports before any write. These examples do not create a client endpoint.

```sql
select id, created_at, moderation_status, approved_at, hidden, report_count,
       title, place, description
from public.recommendations
where moderation_status = 'pending' or report_count > 0
order by created_at asc;

select rec_id, reason, reported_at
from public.recommendation_reports
where rec_id = '00000000-0000-0000-0000-000000000000'::uuid
order by reported_at asc;

-- Clean content only; this statement will be rejected for a >=3-report hold.
update public.recommendations
set moderation_status = 'approved', hidden = false
where id = '00000000-0000-0000-0000-000000000000'::uuid
  and moderation_status = 'pending' and report_count < 3
returning id, moderation_status, approved_at, hidden, report_count;

-- For a >=3-report hold, approve privately first, then adjudicate separately.
update public.recommendations
set moderation_status = 'approved', hidden = true
where id = '00000000-0000-0000-0000-000000000000'::uuid
  and moderation_status = 'pending' and report_count >= 3
returning id, moderation_status, approved_at, hidden, report_count;

-- Separate recorded adjudication only; never run this as automatic approval.
update public.recommendations
set hidden = false
where id = '00000000-0000-0000-0000-000000000000'::uuid
  and moderation_status = 'approved' and hidden = true
returning id, moderation_status, approved_at, hidden, report_count;
```

The last statement needs a human decision and must not be run just because the row is approved. A fresh report may hide it again. Use an operator-controlled delete/hide path for violations; do not put SQL Editor credentials, privileged tokens, reporter identities or decision logs into the app or repository.

## Rollout and verification

After backing up/reviewing the current Community tables, apply `schema-community-premoderation.sql` after the hardening and personal-ownership migrations. Confirm the initial queue is pending/hidden, the migration ledger key is present, repeat application does not hide approved rows, and the aligned client displays the author's pending message. Test a disposable direct authenticated insert/edit that tries to publish, a clean operator approval, a three-report hold with separate adjudication, and a blocked author view. Verify ordinary authenticated users cannot update moderation/counter columns. Complete one safe support-mailbox report and operator response. Record production postflight separately from the local SQL and client tests.

If the owner cannot yet provide moderation staffing and response coverage, do not treat a technically pending queue as a staffed public Community service. A temporary pause on posting is an owner product decision rather than an assumed source change.
