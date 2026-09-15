import { createDeletionWorker } from '../_shared/revenuecat-deletion-worker.mjs';

Deno.serve(createDeletionWorker({ env: Deno.env, fetchImpl: fetch }));
