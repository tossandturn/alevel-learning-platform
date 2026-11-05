# Four-role romance case — 2026-11-06

## User decision and scope

User asked for a shared main storyline resembling the public play structure of 百变大侦探, chose realistic romance plus mystery reconstruction, and then explicitly asked for a murder case. The original story is now a fixed-truth four-suspect case in a new `before-rain` v4 content edition, retaining the installed client's v2 wire capability.

Reference: [publisher feature description](https://apps.apple.com/cn/app/id1366306910) for scene investigation, private discussions and authored plot mechanisms; [inkle narrative-state documentation](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md) for gated narrative sections. No commercial script was copied or claimed to have been read. No dependency was imported.

## Implemented

- A common death, distinct time/alibi questions, 12 cross-checkable evidence items, fixed culprit and fixed complete explanation.
- Two investigation gates and a final evidence/individual-decision gate. Authored stage reveals are committed once and survive reload. Wrong votes and ties do not rewrite the culprit.
- Four full identity books with three separately unlocked private chapters each; current/past only, never future chapters. Each role must question people outside its romantic pairing.
- Public case questions can route to the DM; named witnesses reply as themselves. AI never impersonates a human-controlled role.
- Early NPC generation receives the authored cover, not the complete culprit account; the full account becomes available only once the final public evidence is complete. Human culprit-role readers still receive their own full private book.
- Separate personal relationship decisions. Romance does not manufacture an alibi, override refusal or excuse the fictional act. Eight-year separation, six-year programme cancellation and tonight's case remain distinct.
- New rooms use v4. Old v1/v2/v3 rooms and the duet remain pinned, without destructive migration. Existing scene images reused; no sound effects, new client upload or unrelated service change.

## Verification

- RED observed for the missing v4 case before implementation.
- PASS `npm run test:tavern-stories`: latest 1–4-human journeys, actor/DM privacy, chapter gating, idempotent reveal, persisted state, wrong vote, new/legacy romance, existing four-script v1/v2 journeys, duet, image/privacy/memory tests.
- Old edition tests now explicitly pin synthetic lobby fixtures rather than accidentally testing latest data through a legacy fixture. No student database is used.
- PASS `node scripts/test-stem-native-auth.mjs` and `git diff --check`.
- PASS frozen 1.0.92 native-runtime adoption: 12 role/stage views, server-authored scene intros, full current private books (1,783–2,391 characters), no future chapters, voting and ending. No client upload. This is protocol/page-state verification, not physical-device acceptance.
- Production checks recorded below after execution. Source checks alone are not production acceptance.

## Product correction / limitations

The earlier content had character histories and relationship choices but insufficient shared dramatic action. Rich character descriptions do not substitute for a common event, interdependent information and consequential progress. This correction is tracked in the task QA record without modifying the user's protected `.learnings/ERRORS.md`.

AI prose remains generative; the fixed case state, future-chapter permissions and verdict are server-enforced. This is not a claim that all possible dialogue is semantically fact-checked. Existing rooms keep their old plot to avoid overwriting players' ongoing story; the murder case requires a new room, not a new Mini Program release.

## Deployment

- Initial content/runtime release `ac7b4e2` activated after exact-source/resource and verified rollback gates. It uses six allowlisted backend modules; no production build or client upload.
- Old v3 synthetic canary survived with the same private book, stage and already discovered clue.
- First live acceptance caught an explicit “主持人” request being routed to the romantic partner. Reproduced RED locally, added host-address and investigation-intent cases, fixed in `b34c5b3`; full Tavern regression passed again. Final live replay follows the routing patch.
- Routing-patch live replay completed all 1–4-human journeys with fixed truth, staged private books and separate personal outcomes. Manual reading caught one DM instruction conflating team conclusion with private stance. Added canonical server-authored operational guidance (correct “本局 → 本幕任务 → 共同结论 / 核验答案” and “我的身份 → 本幕决定” controls); ordinary character and interpretation responses still use AI. RED reproduced, then complete Tavern suite passed. Final deployment replay checks these exact controls.
- Further manual reading caught a suspect moving an authored visit to an invented adjacent room. Made the cover explicitly name the fixed room and added a narrow authored visit guard before saving dialogue, with tests for both bad alternate locations and valid denials. It does not add model calls and does not claim universal semantic verification. Only the observed family of critical visit errors is mechanically checked.
