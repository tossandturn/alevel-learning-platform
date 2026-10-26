# AI Coach IELTS Teacher

Adds a fixed, text-only IELTS teacher role alongside the admissions advisor. Existing Coach, Tavern, native IELTS, speech, provider, and authentication configurations remain unchanged.

Runtime files: shared `server/advisorConversationEngine.js`, thin unchanged-contract `server/admissionsAdvisor.js`, new `server/ieltsTeacher.js`, and minimal `server/aiApi.js` registration. No dependency change or migration of existing data. `tavernConversationStore.js` is unchanged.

## Contract

- Persona: `ielts-teacher`; API prefix `/api/ai/ielts-teacher/`.
- Resume, paged history, explicit delete, and SSE stream use the admissions canonical envelopes.
- Independent `ielts-teacher/ielts-teacher.sqlite`, fixed role-scoped request hashes, ownership validation, durable result receipts and clear/delete boundaries.
- 12,000-character input. New teacher deadline capped at 50 seconds, leaving headroom below the 55-second native client timeout; admissions deadline contract is unchanged.
- Uses current `providerCandidates(config.coach)` and signed-login authorizer. Do not describe this as new global membership or active-exam enforcement for no-attempt roles.
- No client-supplied persona/system/history, no cross-role auto-import, no browser or file/audio access.

The teacher offers study planning, Writing coaching, evidence-based Reading/Listening explanations, and text-only Speaking practice. It must not invent prompt/chart/transcript evidence, claim official scores, evaluate pronunciation/real spoken fluency from text, or guarantee a score increase. Uses current official IELTS criteria references in the prompt source.

## Verification and release

`npm run test:ielts-teacher`, full admissions adversarial regression, existing Coach/Tavern/provider/stream tests, isolated native client acceptance and independent review must pass before release. Deployment is an allowlisted pinned source overlay with verified rollback and fresh strict readiness gates; no production build or IELTS service restart. Real configured-model acceptance uses disposable synthetic identities/history only. Physical phone and iPad remain NOT VERIFIED.

## Delivered

- Runtime commit `0e502cbb194ef428565aa4163a89c9c3a14c48c1` deployed as a four-file pinned overlay. Archive and rollback hashes verified; strict before/after readiness gates passed. Existing IELTS service PID/restart count and protected file hashes remained unchanged. No environment update, production build or existing-data migration.
- Teacher focused suite, admissions adversarial suite, Coach/Tavern/provider/stream regressions, full native client suite, transformed-package suites, isolated native journey and independent review: PASS.
- Deployed code plus real configured model, isolated synthetic identity/history: three turns completed in 4.428 / 7.809 / 1.521 seconds; replay, six-message history, cross-role isolation and synthetic clear passed. These are server-side fixture observations, not physical-device latency claims.
- First live attempt failed an assertion without retaining its failing follow-up answer. The cause is unconfirmed and the failed receipt is preserved. A subsequent captured run passed; the harness was improved to validate correct grammatical clauses instead of requiring the literal word `makes`.
- Public unauthenticated teacher resume returns 401. No private student state used in acceptance.
- Client runtime `ac9eaf003bf622263f52cab61ccefc55c394469e` uploaded as development version **1.0.61**, official `success:true`. No public review or public release performed. Physical phone/iPad remains NOT VERIFIED.
- Evidence directory: `D:/CodexWork/ielts-teacher-20261027/`.
