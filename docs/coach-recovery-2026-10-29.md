# Academic Coach reconnect recovery

## Evidence and scope

- Native academic requests previously shared a single 55/60 second client lifetime with authentication, upload and provider execution. A completed/partial academic answer had no durable task receipt. The screenshot proves a client timeout, not a specific upstream incident; historical provider logs cannot identify the exact phone request.
- Live source identity for `server/aiApi.js` matched the `b39bc55` baseline. This overlay changes only that module plus `coachJobs.js` and `coachJobStore.js`. Existing DeepSeek model, credentials, IELTS, Tavern, admissions and provider deadlines remain unchanged.

## Contract

- Client-generated `cj-…` ID. `POST /api/ai/coach/jobs/{id}` returns 202. Same owner, ID and exact payload replays the same task; changed payload returns 409. `GET` polls progress/result; no duplicate provider call on transport retry.
- Reuse the existing Coach stream execution and source/prompt policy. Authentication and assessment binding are checked on submission and polling. This does not introduce a new subscription or global exam permission policy.
- Uploaded images and full request text live only for execution, with existing temporary image cleanup. Persist only hashed owner, request hash, minimal assessment IDs, partial/terminal answer and timestamps. No bearer/session/provider credential is stored.
- Results expire after 24 hours. Maximum 4 active jobs globally and 1 per owner; maximum 1,024 retained jobs; partial answer 64 KiB, terminal envelope 128 KiB. Private SQLite, bounded retention cleanup. Single STEM PM2 worker only; not a distributed worker design.
- Completed answers survive a worker restart. In-flight requests become explicitly interrupted and require a deliberate retry; never automatically rerun an unknown paid generation after restart.
- Client uploads with a separate 30-second HTTP budget and polls with 8-second requests; foreground recovery window 120 seconds. This is a transport recovery budget, not an increased model deadline. IDs/hashes only are saved locally, scoped to owner/privacy epoch and cleared on explicit logout. Longer network outages retain the receipt for retry.
- No guarantee that mobile networks or model providers never fail. Incomplete provider output is never presented as completed.

## Reference

Design reference (no implementation copied): [Microsoft API Guidelines, long-running operations and idempotent status monitors](https://github.com/microsoft/api-guidelines/blob/a7022a299442a8352431874e63ec4dff548a1b81/azure/Guidelines.md#long-running-operations). The existing REST route conventions are preserved.

## Verification

`node scripts/test-coach-job-store.mjs` and `node scripts/test-coach-jobs.mjs`: duplicate/lost acknowledgement, disconnected client, private result access, current assessment recheck, completed-result restart recovery, interrupted execution, expiry and concurrency caps.

Legacy Coach answer/policy/features/image/source access, provider deadlines, and stream recovery suites are required. Production and native acceptance are recorded separately; local tests do not imply deployment.
