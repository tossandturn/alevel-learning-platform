# Campus Elective Implementation Plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** Deliver one complete original two-person campus romance, with cooperative puzzles and earned story reveals, without reinterpreting existing rooms.

**Architecture:** A new version-pinned server-only content module exports the game and scoped state helpers. Existing room storage remains authoritative; only solved stage revelations and separate final choices can alter outcome. Existing native client contracts render the new content and anime assets.

**Tech Stack:** JavaScript ESM, Node SQLite room store, existing AI adapter, WeChat native v2 content protocol, built-in image generation and hashed WebP media.

## Task 1 — content identity and complete characters

Files: `server/scriptCampusElective.js`, `server/scriptGameCatalog.js`, `scripts/test-script-campus-elective.mjs`.

1. Add failing catalog assertions: `assert.equal(newScriptGame('last-elective',2)?.roles.length,2)`; assert one new catalog entry and hashes of existing games unchanged.
2. Run `node scripts/test-script-campus-elective.mjs`, require the expected missing-book assertion.
3. Author `CAMPUS_ELECTIVE_GAME`, stable ID/edition, two full roles, three stages, six clue cards, three unique puzzles, sealed reveals and current-choice outcomes; register exact edition in catalog.
4. Run content/schema and puzzle-solution assertions, including enumerated unique coordinate and order solutions.

## Task 2 — authoritative unlock and consent

Files: `server/scriptCampusElective.js`, `server/scriptRoomStore.js`, `scripts/test-script-campus-elective.mjs`.

1. Add failing real-store journeys for both roles and both-human play, locked future pages, wrong answers, duplicate solve and restart.
2. Add helpers `campusStageResolution(game,room)`, `campusNpcDecision(game,roleId,stage)`, `campusReplyActor(game,speakerId,seats)`, `campusOutcomes(game,room)`, `campusActorContext(game,room,role,view)` and visible public-reveal context.
3. Call scoped helpers only for the matching content edition. Gate final choice on solved third puzzle. Keep legacy reveal and ending behavior byte-pinned.
4. Verify 9 final-choice combinations and no outcome overridden by atmospheric vote; full negative-path suite.

## Task 3 — dialogue and memory

Files: `server/roleVoices.js`, `server/scriptSceneBeats.js`, `server/scriptRoomApi.js`, focused tests.

1. Add failing voice, exact turn ownership, AI context secret/future answer exclusion, explicit refusal, and cross-act private appointment tests.
2. Add two stable voices and one AI entrance per stage; keep narrative separate and avoid scripted human reactions. State any campus-only rendering/puzzle constraints as backstage instructions, not dialogue.
3. Verify constrained character context, actual transcript retrieval, bounded repair and existing Tavern regression tests.

## Task 4 — original anime package

Files: `server/scriptArtSpec.js`, `server/tavernMedia.js`, `public/tavern-media/v1/script-campus-scenes.json`, hashed image assets; art tests.

1. Assert 8 campus assets and no fallback station images; future-stage reference fences remain enforced.
2. Generate each scene/portrait/object/ensemble with built-in image generation, inspect and preserve selected originals in task workspace. Derive web-sized assets with content hashes and catalog metadata.
3. Add a separate optional campus manifest to the media reader; no deletion/replacement of old assets.
4. Verify all assets served with valid hashes, reasonable transfer size and correct reference/style mapping.

## Task 5 — review and release

1. Read both role books and all three-stage paths; fix contradictions before using AI acceptance as evidence.
2. Run `npm run test:script-campus`, `npm run test:script-scenes`, `npm run test:role-voice`, `npm run test:tavern-stories`, `npm run test:script-art`, `git diff --check` and scoped secret scan.
3. Run frozen v1.0.92 client views and isolated native fixture; no client upload. Record visual limitations accurately.
4. Commit only scoped files, push branch, build pinned allowlist artifact locally; fresh remote readiness plus verified exact rollback before mutation.
5. Authenticated production: preserve old-room canary; both solo roles, two-human choice boundaries, real AI hints/care/refusal/continuity, assets and both service health. No real student data modified.
6. Publish only this book when acceptance passes, report remaining limits. Do not begin the other proposed books in this release.
