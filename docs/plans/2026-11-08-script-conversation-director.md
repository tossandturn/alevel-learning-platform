# Script conversation and DM guidance Implementation Plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** Make existing script-room characters answer in natural short chat bubbles and actively continue a thin conversation; make the DM give timely, accurate UI guidance without feeding that guidance back into character dialogue.

**Architecture:** Backend presentation and validation changes only. Preserve all authored books, clues, puzzles, decisions, snapshots and client v2 protocol. Existing native client already renders `parts` as separate message bubbles. Add bounded reply validation and punctuation-preserving reflow; add server-owned DM orientation/milestone messages of kind `system`, excluded from actor memory.

**Tech Stack:** Existing Node ESM / SQLite room engine / JSON model interface. No new dependencies or database migration.

## Scope and reference boundaries

The directly requested scope is character short replies, removal of canned acknowledgment, proactive topic leads and DM help. The newly attached document additionally mentions authentication/nickname, physics diagrams and redrawing characters; clarification was requested before expanding to those workstreams. The attachment is unchanged and stays outside Git. Its screenshot and four text sections were read; no document-layout edits are requested. Bundled LibreOffice is unavailable on this Windows runtime, so no layout-render claim is made.

- [SillyTavern original group-chat documentation](https://docs.sillytavern.app/usage/core-concepts/groupchats/) describes current-speaker cards and distinct turn-selection strategies. Keep our existing visibility boundary; do not merge all roles or add a five-second unattended generation loop. No upstream source is copied.
- [Original repository license](https://github.com/SillyTavern/SillyTavern/blob/release/LICENSE): AGPL; no dependency or source import is needed.
- A public same-name [《爱慕未停》 creator page](https://aipiaxi.com/article-detail/560756) describes a two-person voice-acting script and prohibits commercial adaptation. This was not verified as the user's named 百变 version. No plot, wording, character or sequence is copied or claimed to have been played.

## Acceptance

1. Reject “这句话我记下了”, “你的话我记住了” and standalone canned memory acknowledgments before persistence. Do not block concrete recollection such as remembering an actual place or object.
2. Default output targets one to three short speech bubbles; long requested explanations have a separate bounded budget. Reflow only at punctuation/paragraph boundaries, never truncate evidence or split arbitrary characters. Narrator and actor remain distinct.
3. Thin replies such as “嗯 / 你说吧 / 不知道聊什么” receive a concrete in-character lead, not another empty acknowledgment or generic “你想聊什么”. Explicit requests to pause/stop do not force another question.
4. DM opening guidance points to the existing right-top “本局” → “我的身份” / “本幕任务”. Milestone guidance identifies only the next required step. No automatic clue grant, solve, mission choice or stage advance.
5. Helper/system text is excluded from actor history and recollection selection. Narrative DM lines remain available. Private guides stay private, do not expose another role's choice, and are not repeated on GET/retry/reconnect.
6. Existing script tests, old-room state/edition hashes, both solo roles, two-human progress, visibility, idempotency, failure/retry, frozen native client and real-provider conversations must pass. Publish only after fresh readiness/rollback and authenticated live acceptance gates.

## Steps

- Add focused conversation and director tests, see failures, then add `server/scriptConversation.js` and `server/scriptDirector.js`.
- Wire reply projection/validation into all three script prompt paths and the existing single-repair mechanism. Use immutable copies.
- Wire opening and milestone guidance into room transactions; tag operational replies as `system`; filter them out in `scriptRoomMemory.js`.
- Run scoped regressions, inspect actual native short bubbles, then rehearse with the configured provider using synthetic rooms. Record model limitations separately from workflow success.
- Review allowlisted diff, push tested commits, deploy backend only if a fresh exact-target gate passes; retain rollback. No client publish or unrelated auth/Coach/media changes in this slice.
