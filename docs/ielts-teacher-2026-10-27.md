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

Final release identifiers and evidence are recorded after actual deployment; this document alone does not establish deployed or publicly released status.
