# Coach confirmation, WeChat AI and three curated stories — implementation plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** Deliver the user's approved three changes without reverting 1.0.93 fixes or invalidating ongoing story rooms.

**Architecture:** Diagram capability is separate from consent: text first, one optional offer from the same model response, and drawing only after an explicit request. Merge the existing WeChat AI candidate onto the current Mini Program baseline, not its old 1.0.86 parent. Version three curated story editions while retaining every historical reader and preventing new creation of retired books.

**Tech Stack:** Existing Node ESM backend, native WeChat JS/WXML/WXSS, current WeChat AI Skill/Handoff contract, existing server-side room rules and image assets. No new provider, production build, payment changes or database migration.

## Scope and authority

- User approved implementation on 2026-11-13 (Asia/Shanghai); the previous proposal-only restriction is superseded for these three changes.
- Backend baseline: `2c705879a159a0321e9686686b98f6f54d9eb7be` (runtime grounding candidate `79d923d`). Preserve unrelated `.learnings/ERRORS.md` and `.tmp-test/`.
- Client baseline: `3ff6bf2b0e832542a08d6f2a6d55fb97574b2de0`, runtime `17c480b`, uploaded developer version 1.0.93.
- WeChat AI source candidate: `c8f605bf7e04ba263779c96641a65c951272366d`; never replace the current package with its 1.0.86 base.
- Persistent STEM implementation task owns client edits; root owns backend and release coordination. No simultaneous writes to a shared file.
- Retire only new-room entry points. Preserve old rooms, exact editions, private messages, choices, images and replay receipts. Do not delete the separate Tavern personas.

## Task 1 — Consent-based academic diagrams

**Files:** `server/coachDiagram.js`, `server/coachPolicy.js`, `server/coachPhysicsDiagram.js`, `server/aiApi.js`; new `server/coachDiagramConsent.js`; tests `scripts/test-coach-diagram-consent.mjs` and existing diagram/API tests.

1. Add failing tests for default text-only prompt/output, conditional offer, explicit draw, refusal and invalid intent. Example contract: `assert.equal(resolveCoachDiagramIntent({diagramFormat:'stem-diagram-v1'}).draw,false)`; `assert.equal(resolveCoachDiagramIntent({diagramFormat:'stem-diagram-v1',diagramIntent:'draw'}).draw,true)`.
2. Implement strict `diagramIntent: ask|draw|decline`. Keep `diagramFormat` as capability only. User's explicit typed request can draw directly; source/quoted instructions and negative requests cannot grant consent.
3. Default prompt omits rendering recipes and requests only text plus a conditional final question. No second model call to decide whether to offer. Strip unsolicited diagram payloads before both JSON and streaming delivery.
4. Offer contract: optional `diagramOffer:{type:'force',question:'需要我补一张受力图说明吗？'}` on a complete successful answer. Draw preserves the existing diagram schema and original help/exam restrictions.
5. Test JSON, split SSE, jobs/recovery, old clients, hint/exam denial and request idempotency. Run `node scripts/test-coach-diagram-consent.mjs`, `npm run test:coach-diagram`, and relevant policy suites; record RED then GREEN rather than weakening old scientific invariants.

## Task 2 — Native confirmation and WeChat AI integration

**Owner:** persistent STEM task in `../client` only. Existing baseline product/device contracts remain authoritative.

**Files:** existing Coach/API/shared panel/native photo entry modules; `app.js`, `app.json`, build manifest helpers; candidate `agent/`, `skills/learning-navigator/`, `bundles/ai-entry/`, `utils/agentHandoff*`, generator/knowledge/evaluation/test files.

1. Diff the candidate against its exact parent and apply only its feature changes to the new baseline; resolve app/build/package intersections explicitly.
2. Preserve safe Handoff navigation: supported destinations only, payload/query precedence, ownership isolation and expiry, no auto-payment/download/send/camera/microphone. Native auth remains the authority.
3. Add small drawing confirmation controls only after a valid offer. Decline sends zero requests; confirmation retains the first answer and original owner/question/image/help context. Changing question/account clears the offer. A failed supplement cannot erase the original answer.
4. Regenerate four knowledge TXT files and evaluation cases from maintained sources, including current download rules, source-aware AI limits, optional drawings and three-story catalogue. No misleading claims about availability or official scores.
5. Run focused RED/GREEN tests, full `npm run test:all`, exact packaged-module tests, WeChat compilation and source/main compiled size checks without lowering headroom gates.
6. Verify actual AI-mode tool calls and Handoff through supported official tools if available. Separately label native UI, platform activation, knowledge ingestion/recall and physical-device acceptance; ordinary compilation is not AI invocation proof.

## Task 3 — Three curated books with historical compatibility

**Files:** `server/scriptGameCatalog.js`, a new `server/scriptStudentEditions.js`, narrowly necessary room/store and voice-context adapters; tests `scripts/test-script-curated-catalog.mjs` and `scripts/test-script-student-editions.mjs`; existing editorial/memory/room tests.

1. Add a failing assertion that the new-room catalogue has exactly three books, one per approved content line. Preserve `scriptGame(id,version,edition)` for all seven old books.
2. Prioritize a new high-school campus edition of `last-elective`; a cooperative summer-school/world-exploration edition of `inverted-observatory`; and the mature, non-graphic mystery/low-horror `thirteenth-curtain` as the optional genre contrast. Final public names follow the completed authored content, not a merely relabeled old story.
3. Keep identities, motivations, facts, task dependencies, clue releases and endings stable per edition. Campus affection remains optional and age-appropriate; clues never force acceptance of romance. Ordinary leisure talk is not tutoring.
4. Retired-book creation is rejected server-side, including old-client requests. Existing joins, resumed rooms and same-receipt replay remain readable; do not strand an uncertain previously created room.
5. Exercise 1–4 player seats where supported, solo AI fill, private/public permissions, complete acts, hints, ties/endings, interruptions and cross-act memory. Retain historical tests with an explicit historical-reader scope rather than silently deleting them.
6. Inspect the existing illustrations against the new content; reuse only compatible original anime assets, and create replacements if necessary. Preserve older content-addressed URLs.

## Task 4 — Integration and bounded release acceptance

1. Review source/knowledge/catalogue consistency and run full relevant suites with sanitized evidence.
2. Inspect fresh phone/tablet renders and supported WeChat AI-mode invocation; preserve genuine NOT VERIFIED cases.
3. Before remote operations, use the mandatory read-only resource/service/rollback gate. No server build or dependency compilation. Stage a pinned allowlisted artifact and retain exact raw rollback bytes and old edition readers.
4. Perform bounded synthetic authenticated production acceptance: default answer without drawing, explicit drawing, permissions, three-entry catalogue and existing-room compatibility. Record actual source/model/request timing; no repeating failed calls until PASS.
5. Prepare/upload the next developer package only after main-package gates and compiled-byte checks. Do not conflate developer upload, experience-version selection, AI platform activation, submission or public release.

## Completion evidence

Record code changes, tests (including failures), actual platform/model acceptance, exact package/version and deployment state. No secret values, real student conversation bodies, tokens or databases in evidence, Git, client code or prompts.
