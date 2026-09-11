# Wayfinder account deletion release runbook

The app now stops new writes, invalidates in-flight reads and uploads, waits for
the active photo upload to settle, queries every owned photo row with pagination,
recursively finds orphaned objects below the account Storage prefix, and removes
Storage objects in batches before calling `delete_my_account()`. Any Storage
listing or deletion error stops before the auth identity is removed.

Before release, validate this sequence with disposable Wayfinder identities in
an isolated Supabase project:

1. Create more than 500 photo metadata rows, multiple Storage folders and at
   least one orphaned object below the user's UUID prefix.
2. Start an upload, begin deletion, and verify the upload cannot recreate data
   after enumeration.
3. Force list and remove failures separately. The account and canonical rows
   must remain so deletion can be retried.
4. Complete deletion. Verify `auth.users`, progress, trips, memberships,
   projections, photo metadata and every owned Storage object are gone.
5. Confirm another account's rows, files, groups and purchases are unchanged.

RevenueCat customer deletion is a release blocker. The public mobile SDK can
log out and change identities, but it must never receive the RevenueCat secret
needed for administrative customer-data deletion. Add a server-side deletion
step, authenticated with the departing Supabase user's JWT, that deletes or
anonymises the matching RevenueCat App User ID under the provider's current
data-deletion procedure. Store the RevenueCat secret only in the server's secret
manager. The server must complete this step, or record a retryable deletion job,
before reporting the deletion request complete. Verify the exact current
RevenueCat API and retention behavior during privacy release review.

Do not ship account deletion as complete until the RevenueCat step and the
isolated Supabase cases above pass. No production account, Storage object or
RevenueCat customer was changed while preparing this runbook.
