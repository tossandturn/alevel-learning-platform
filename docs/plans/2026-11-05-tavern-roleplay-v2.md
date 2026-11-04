# Tavern roleplay and four-script refinement

> For implementer: TDD. Record a failing assertion before changing production code.

Goal: deliver the user's already requested browsing-first, authored, illustrated 1–4-player Tavern experience; refine the existing four scripts rather than replace the product.

Architecture: preserve immutable v1 scripts for existing rooms; use version 2 for new rooms. The server remains authoritative over identities, private knowledge, missions, clues, votes and endings. AI is a performer, not a state editor. Existing login, payment, IELTS and paper interfaces remain untouched.

Tech stack: existing Node/SQLite backend and native WeChat coach subpackage; no additional runtime dependencies.

## Reference assessment (2026-11-05, Asia/Shanghai)

- User reference https://sillytaverncn.com/character-cards/ describes motivations, private information, situational world information and player agency. Free personal download does not establish permission to repackage community stories commercially. No third-party card, jailbreak, regex, executable template or prose is imported.
- Original project https://github.com/SillyTavern/SillyTavern and https://docs.sillytavern.app/usage/core-concepts/characterdesign/ describe character identity, scenario, greeting and dialogue examples. AGPL implementation is not copied or installed.
- https://docs.sillytavern.app/usage/core-concepts/worldinfo/ informs bounded relevant lore selection. Our authored lore additionally has server-enforced act/knowledge gates; a keyword cannot unlock a future secret.
- https://github.com/malfoyslastname/character-card-spec-v2 is an interoperability reference only; no unrestricted system prompt or post-history instruction import.
- Four existing scripts are original. Public-domain structural inspirations remain recorded in the previous plan. Names and plot details from the newly provided market are not copied.

## Accepted scope and decisions

The user supplied the product design and authorized implementation/deployment in the local workspace policy. This follow-up retains that design. A prompt-only refresh would not fix the missing mission/image paths; wholesale migration to SillyTavern would add an unrelated server and incompatible auth. Use a small native versioned role-card and rules extension instead.

1. Browsing-first entry and unchecked consent: regression-test existing code; no forced login added. Joining/creating rooms and AI still require the current verified account.
2. Each of 16 game characters receives a distinctive conversational style, concrete habit, contradiction, three act beats, original dialogue examples and three personal choices. Choices are persisted and private; declining disclosure is a valid branch. Choosing is not synonymous with AI judging the user's prose.
3. Bots discover their own evidence but do not dump it at act start. Players explicitly ask each bot for its discovery; release is deterministic and cannot be blocked by model latency. Human-owned evidence is never automatically shared.
4. Advance requires shared evidence, the authored puzzle (if any), and each human's current role choice. A personal epilogue shows the actual saved decisions, not a fabricated score. Existing v1 rooms retain their prior mechanics and answers.
5. Dialogue supports separately validated narrator and actor segments. Neither model output nor a player prompt can impersonate another human or mark an objective complete.
6. Explicit scene requests in script rooms create image jobs. Only public setting/current scene/visual canon go to the image provider, not private cards, hidden truth or future clues. Results stay in the requesting channel, are labelled atmosphere-only, can be enlarged and survive page reloads. Image failure does not block text or story progress.
7. Image data is private authenticated room data, capped per file/room/global store and removed with room retention. Persist status; uncertain in-flight image calls after restart require explicit retry instead of silently regenerating.
8. Pre-generated act illustrations match each of the four settings, with no puzzle answers in pixels. Images follow the act/message that introduced them.

## Tasks and checks

### 1. Versioned cards and private missions
- Add `server/scriptRoleCards.js`; extend `scriptGameCatalog.js`, `scriptRoomStore.js`.
- Add `scripts/test-script-roleplay-v2.mjs`: 4 scripts × 4 roles have distinct cards/3 choices; no future beat leakage; old-room v1 preserves data; future/other-role choices rejected; valid decline branch; retry idempotent; restart preserved; incomplete choice cannot advance.
- Run `node scripts/test-script-roleplay-v2.mjs` (RED then GREEN).
- Update full play-through tests to request AI evidence and choose explicitly only for v2; never weaken secret assertions.

### 2. Actor/narrator contract
- Add bounded validation shared by API and store. Legacy `text` accepted; new `segments` contains only third-person narration and current actor speech. Invalid speakers are rejected before writing.
- Test invalid player impersonation/unknown fields, public vs private memory, stable canonical facts and late stage output.

### 3. Illustrated room pipeline
- Extend `scriptRoomStore.js`, `scriptRoomApi.js`, `tavernImageGeneration.js`, and narrow `aiApi.js` wiring.
- Test image request stage/owner/channel snapshot, authenticated bytes, cross-room and public/private denial, retry/restart/expiration/budget, no hidden canon in provider payload, and image failure independent of game.
- Add 8 original act images via built-in imagegen; hash/inspect and attach to v2 only.

### 4. Native interface
- Extend `bundles/coach/scriptRoom.js/.wxml/.wxss`, `scriptRoomApi.js`; use existing explicit image-intent detector.
- Identity tab: private current choice, saved timeline. Evidence tab: AI discovery requests and actual next-action checklist. Chat: separately styled narrator/speech, image jobs inline, no fake progress/ETA.
- Test account/consent isolation, stale responses, stable retries, image cache deletion on account change, and no native input overlap.

### 5. Acceptance and delivery
- Run affected backend suites and client `npm test`, `test:device`, `test:image`, `test:pages`, `test:wechat`; full client suite where practical.
- Native phone and tablet/layout evidence; distinguish simulator from real-device/multi-phone results.
- Run authored play-through of all four games with 1–4 humans plus actual production role/image acceptance after a passing server readiness gate.
- Pin commits; allowlisted incremental deployment with backups, no production source build, no IELTS restart. Upload a new development version only after compilation/package budget checks; do not call it experience/public release until actually selected/approved.
