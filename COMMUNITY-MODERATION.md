# Community moderation

11 September 2026 — local implementation and operator draft; no production migration or moderation action has been performed.

## Repaired locally

The earlier `schema-recommendations.sql` grants authors row-level update permission without limiting fields. An author could therefore change vote totals, reset report counts or clear `hidden`. A disposable PGlite reproduction confirms the flaw before applying the repair.

`supabase/schema-community-hardening.sql` limits author inserts/updates to the content fields used by the app. Server triggers maintain vote and report totals. A vote cannot be moved between posts or people. A held post stays hidden when a reporter deletes their account; another report cannot clear an operator hold. Authors can still edit their own words or delete their own posts.

Run `node tools/test_community_security.mjs`. It exercises actual PostgreSQL privileges, RLS and triggers with disposable in-memory users. Current result: 23 passing checks. It does not claim that these rules are deployed or that reports are being reviewed by a person.

## Operator process to establish before public launch

The owner must assign a person to monitor Community reports and the published support mailbox, set a review schedule and define what content is removed. The temporary published mailbox is `rambodog555@gmail.com`, as confirmed by the owner. No moderation account or outside service was registered by this work.

Use an authorised Supabase dashboard session or a protected server tool for operator actions. Never grant mobile clients permission to update `hidden`, aggregate counters or another person's post. Never put a service-role key into the PWA, native assets or GitHub Pages.

For each report:

1. Review the post and its reports, recording the post ID, reason and decision in a private operator record. Expose no reporter identities publicly.
2. Keep `hidden = true` for a post awaiting review or requiring takedown. Three reports already apply this hold automatically.
3. If the post is acceptable, an operator may clear `hidden`. Existing report rows remain as evidence. A new report, or replaying the migration while at least three reports remain, can reapply the hold; investigate repeat reports instead of granting the author an override.
4. If removal is warranted, delete through an authorised admin path. The source schema cascades that post's dependent votes and reports, so retain any necessary decision record beforehand under the agreed retention policy.
5. Reply to support requests as appropriate without disclosing another person's private account information. Confirm whether the user needs to block the author in their own view.

The reporting threshold is a temporary visibility control. It is not a substitute for a staffed moderation process, abuse review, an appeal/contact route or the final store review of user-generated content.

## Rollout checks

- Review and back up the production schema before applying this separate migration after `schema-recommendations.sql`.
- Re-run ordinary create/edit/delete/vote/report/block flows against an isolated Supabase environment using disposable app accounts.
- Confirm production ACLs and RLS match the tested schema. Do not re-run old setup scripts afterward if they restore broad grants or replace the hardened report trigger.
- The migration recomputes existing counters from authoritative feedback rows while preserving existing holds. Previously manipulated hidden values cannot be distinguished automatically from real moderation decisions; review held content deliberately.
- Update the release record only after the migration is applied and the aligned client is tested. No publication has been requested as part of this local repair.
