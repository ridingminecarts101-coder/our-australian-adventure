import { createCommunityReviewNotifier } from '../_shared/community-review-notifier.mjs';

Deno.serve(createCommunityReviewNotifier({ env: Deno.env, fetchImpl: fetch }));
