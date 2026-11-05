# Four-role romance murder case implementation plan

> **For implementer:** Use TDD throughout. Write failing tests, observe RED, then implement and verify.

**Goal:** Turn the four-role romance into an original fixed-truth murder investigation with emotional stakes, not two disconnected couple conversations.

**Architecture:** Publish a new internal v4 edition of `before-rain`, keeping wire capability v2 and all existing v1/v2/v3 room snapshots pinned. Keep the separate duet and other three scripts unchanged. Author the case in the backend; rule-engine gates trigger discoveries and the finale. AI performs only the actor's current permitted perspective.

**Tech stack:** Existing Node ESM room store, SQLite snapshots, native Mini Program v2 protocol. No dependencies, production build, or client upload.

## Approved direction

The user chose realistic romance plus mystery reconstruction, then explicitly requested a murder case. Four established adult characters reunite at the old station; programme producer 韩屿 is found dead. The apparent last live broadcast, six-year-old cancellation, individual alibis and old love affairs form one investigation. No gore. Fixed culprit, fixed evidence, no model-selected murderer.

Public stages: (1) establish whether the apparent last voice was live; (2) reconstruct access and the unresolved visit; (3) confront motives and evidence, make personal choices, vote, reveal the complete chain. Individual romance choices do not change who committed the act or excuse responsibility.

## Sources and adaptation boundary

- [Publisher App Store description](https://apps.apple.com/cn/app/id1366306910): scene investigation, private discussions and authored story/mechanism features. This is a public feature reference, not access to paid scripts.
- [inkle narrative documentation](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md): explicit state and gated narrative sections. No imported library or copied story text.
- Diagnosis: prior v3 second/third acts lacked a shared investigative objective; content and state progression need revision, not only a longer role prompt. Record this product correction in the task's QA notes; preserve user-owned `.learnings/ERRORS.md`.

## Tasks

1. `scripts/test-script-romance-case.mjs`: RED for separate v4, three common objectives, one fixed culprit, staged private chapter visibility, 1–4-human full journeys, idempotent reveal, private boundaries, wrong-vote and consent endings. Hash-pin v3 and the duet.
2. `server/scriptRomanceCase.js`: original case, 12 evidence items, three role chapters for each of four adults, fixed stage resolutions and public case context. Reuse authorized scene art and original personal histories without confusing eight-year separation and six-year programme cancellation.
3. `server/scriptGameCatalog.js`: resolve exact v4 edition; new rooms adopt v4 only. Old room resolution remains unchanged and unknown editions fail closed.
4. `server/scriptRoleCards.js`: append only reached private chapters to the identity book; never spread future chapters into a response.
5. `server/scriptRoomStore.js`: legal NPC decisions, targeted replies, shared case context, authored reveal once after a successful stage gate, fixed case finale and separate personal outcomes. Keep existing share/solve/advance APIs and all old-game behavior.
6. `server/scriptRoomApi.js` / `server/scriptRomance.js`: keep investigation separate from old relationship memories; bounded authored cover stories only, no new evidence/alibis/murderer. Existing memory and quote provenance checks stay enabled.
7. Run `node scripts/test-script-romance-case.mjs`, `npm run test:tavern-stories`, frozen native-client adoption and privacy tests. Update only tests whose latest-edition selection intentionally changes; old-v3 tests pin synthetic snapshots rather than deleting coverage.
8. Review and push pinned source; exact-target readiness plus verified rollback; deploy only allowlisted backend JS. Authenticated production tests: old-room canary preserved, latest catalog v2, 1–4 humans, stage reveal, wrong-vote truth, actual AI investigator/DM responses without spoilers. Recheck both services; no real student rooms or purchases used.
