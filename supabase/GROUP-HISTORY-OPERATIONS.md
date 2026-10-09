# Group sharing and retained-history release steps

This document accompanies the draft client update. Neither migration is applied
by merging the pull request. Keep the client unpublished until the production
postflight has passed. Public iOS 1.1.0 continues to use the older RPC names,
which both migrations preserve.

1. Confirm the production Supabase project is `ajyuozqoukigeeyhvuqc` and keep
   a current database backup. Record counts only; do not copy customer notes,
   names, account identifiers, invite codes, or keys into a release log.
2. In the Supabase SQL editor, run the complete contents of
   `supabase/schema-group-join-choice.sql`. This migration is transactional.
   Run its read-only checks in `supabase/GROUP-JOIN-CHOICE-OPERATIONS.md`.
   Require zero invalid six-character codes, zero inconsistent new sharing
   choices, and all three new RPCs present. Legacy memberships awaiting a
   choice may be nonzero.
3. Run the complete contents of `supabase/schema-group-history.sql`. It is
   transactional and can be replayed. It creates a private, owner-erasable
   snapshot of only what that group could already see when a member leaves.
   Personal records remain with the account. Account deletion cascades the
   snapshot and retains the existing RevenueCat erasure queue. Photos never
   enter the snapshot.
4. Run the complete read-only `supabase/group-history-postflight.sql`.
   Require `invalid_anonymous_rows`, `unconsented_feedback_rows`,
   `missing_account_rows`, `missing_group_rows`, and `ownerless_group_rows`
   all to be zero. Require all six booleans in the second result to be true.
   `retained_rows` may initially be zero. Save only these aggregate values.
5. After both migrations pass, deploy the matching PWA/website client. Verify
   a consented two-account group: leave, named tick/date/rating/note retained,
   later personal edit frozen, former-member erasure visible to current
   members, and account deletion removes retained data. Verify a private join
   shares nothing, an uncertain older row stays anonymous, and photos remain
   on the originating device. Repeat the essential paths on both iPhones
   before a signed native update.

The last member leaving disposes of an otherwise empty group. An old
group-scoped source row can keep an inaccessible retired shell to preserve
provenance; the history migration clears snapshots before that retirement.
The owner still has to transfer ownership before leaving a group with other
members. Explicitly shared trips follow their existing separate rule: leaving
unshares the trip, while the personal trip stays with its owner.

Do not roll back the alias-aware invite lookup after code rotation: previously
sent long invite links depend on it. If postflight fails, hold the client
release, preserve the database state and investigate with a forward repair.
