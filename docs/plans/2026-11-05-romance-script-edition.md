# Romance edition for the emotional script

> **For implementer:** Use TDD. Observe the new-edition test fail before implementation.

**Goal:** Make the one emotional script an adult male/female romance experience, not a friendship/family reunion story, without a client upload or rewriting ongoing games.

**Architecture:** Retain client protocol `scriptVersion: 2`; distinguish immutable content versions privately on the server. New v2 rooms select internal content version 3 / `romance-20261105`, whose client capability is 2. Previous v1/v2 snapshots continue resolving the exact prior game and role books. A rollback to the old server rejects unknown content version 3 rather than reinterpreting it as the old story; progress stays retained for recovery. The other three scripts remain byte-identical. Keep the existing native identity, private chat, three acts, personal choices and ending renderer.

**Story:** 《雨停之前》, four adult characters, two male/female relationship lines. 许知夏/周泊舟: past lovers deciding whether to try again after eight years. 林序/顾晚: long-standing friends who must decide whether to admit romantic feelings. Three acts move from shared memories, through incomplete accounts of separation/avoidance, to concrete reciprocal choices. An invitation may be declined; neither a majority vote nor an AI reply can force a relationship.

## Tasks and acceptance

1. Add `scripts/test-script-romance.mjs` with failing `newScriptGame` assertion; pin old v1/v2 game/book hashes and the other three games.
2. Author `server/scriptRomance.js`: four complete entry books, private motives, 12 stage memories, 12 clue items, 12 personal decisions, original scenes, stable canon and deterministic reciprocal endings. Reuse the existing rain-station illustrations. No imported commercial script text, explicit sexual content or assumption about the human player's gender.
3. Add server-owned edition resolution to `scriptGameCatalog.js` and snapshot creation/loading in `scriptRoomStore.js`. Unknown editions fail closed; replay retains the originally created edition. The API continues accepting existing v2 clients and does not allow clients to supply an edition.
4. Make `visibleScriptRole` prefer an authored edition entry book; retain the exact old projection otherwise. Let AI actors see their own current decision only, never a partner's private choices. Keep narrator/actor separation.
5. Derive each couple's epilogue from both final choices. Public vote chooses only the shared closing scene. Bot decisions are authored options validated by the same engine; a human refusal is never overwritten. No marriage/physical action is assigned to a player.
6. Run new 1–4-human complete journeys, all 16 final-choice combinations, old snapshot restart/replay, private/future-info isolation, frozen v2 client rendering, existing script/Tavern suites, and authenticated API tests.
7. Read the server deployment gate/runbook, pin a source/rollback artifact, deploy only the changed server files, restart only STEM when the gate passes. Verify real catalog, synthetic authenticated new/old-room journeys and a bounded real AI exchange. No real student records are read or modified.

## Design references

[SillyTavern character design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/) informs persistent character background/voice; [Writing with ink](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md) informs stateful choices with observable consequences. These are implementation references, not copied stories or new runtime dependencies.
