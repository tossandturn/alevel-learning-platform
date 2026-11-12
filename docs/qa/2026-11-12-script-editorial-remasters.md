# Seven-book editorial repair evidence

## Status and boundaries

Local implementation and relevant deterministic regressions pass. Independent DeepSeek first-pass reviews exist for all seven complete books; they are not runtime roleplay samples. Six requested revision; Iceland received a model pass with minor comments. Repaired editions have been exported for a separate second review. This document does not claim production activation, real-device play, or a final second-review pass.

Original content remains byte-pinned. New room editions are `before-rain-editorial-20261112` (v5), `thirteenth-curtain-editorial-20261112` (v3), `last-midnight-editorial-20261112` (v3), `inverted-observatory-editorial-20261112` (v3), `one-more-stop-editorial-20261112` (v4), `last-elective-editorial-20261112` (v3), and `venice-blue-hour-editorial-20261112` (v3). All expose client capability 2. Source edition metadata is server-owned and preserves rule/art lineage, including image-job inputs. No database migration and no change to existing room identities.

## Independent review protocol

`export-script-editorial-review.mjs` exports only allowlisted authored fiction and engine semantics. Each packet is content-hashed. Original first-pass packets and raw reviews remain outside Git in `qa/editorial-20261112/before`; revised packets are under `after`. First-pass reviewer omissions included missing `book.` prefixes, `book.engine` instead of `engine`, `examples`/`beats` outside `card`, and an omitted role index for a mission. `normalizeEditorialReview` corrects only a unique candidate path with an exact matching quotation; `validated` files record every correction and the raw SHA-256. Quotes, scores, issues and verdicts are never rewritten to manufacture a pass. All seven first-pass reviews now validate, with their original verdicts preserved.

The initial packet omitted non-duet expanded role books, server-authored public unlock pages, mixed-seat matrices and relationship-result tables. The repaired exporter includes them. Criticism caused by those omissions is separated below from actual defects; no existing implemented behavior is falsely described as newly built.

## First-pass disposition

| Book / issue | Independent disposition |
| --- | --- |
| 雨停 R1 | Accept: the 21:07 recording now has an independent continuously recording source, start time, preservation and clock alignment; it is explicitly not the 19:40 playback file. |
| 雨停 R2 | Accept: the third-act photo evidence includes the original/published crop comparison and signed delivery record. It establishes the crop, not an invented motive. |
| 雨停 R3 | Reject automatic forced publication. Required sharing is a cooperative rule, not a missing engine route. Explain the fixed AI evidence request and explicit human departure paths in the packet. A player refusing to cooperate may stop the group; that does not authorize disclosing their private book. |
| 雨停 R4 | Accept: rewrite 周泊舟's three private chapters as in-world experience; remove AI/server directives. System guardrails remain in backend prompts. |
| 雨停 R5 | Accept: remove the person's name from the entry-time card, requiring the parallel hallway recording and access conditions to identify him. Culprit and times unchanged. |
| 落幕 R1 | Accept: stage lights may flash out; the independently powered console logging stays continuous. |
| 落幕 R2 | Accept: synopsis identifies 陆弦's sighting rather than inventing four matching eyewitness claims. |
| 落幕 R3 | Accept: first-act calibration does not expose the playback timestamps; these move to the second-act projection log. |
| 落幕 R4 | Reject forcing a private choice to publish testimony. The suspect can share a fixed evidence card without confessing. Sharing and verbal explanation remain distinct, with explicit guidance. |
| 落幕 R5 | Export omission: existing scene generation filters every human-controlled speaker. Add all nonempty human-seat combinations to review material and assert all subsets for every act. |
| 落幕 R6 | Existing highest-human-vote/tie behavior is preserved, exported and now stated on the new edition's ballot. AI recommendations do not outvote humans. |
| 落幕 R7 | Accept ambiguity, not automatic speech: new mission receipts say the choice is an intention and remains private. Player may voluntarily say it in chat; it does not manufacture confession, retraction or promise. |
| 落幕 R8 | Accept: replace the moral-summary fallback entrance with specific fear and the manuscript in hand. |
| 零点 R1 | Accept: third-act opening shows names and a repeating broadcast without revealing the visitor-list/program explanation before evidence. |
| 零点 R2 | Accept limited feedback: immediate private choice note plus an optional shared pause after the second objective. Do not make another character magically know a private choice. |
| 零点 R3 | Export ambiguity: fixed AI-owned evidence is legally publishable by the deterministic request route, not restricted to already-public evidence. No secret identity or future clue is emitted. |
| 零点 R4 | Accept: 叶澄's sample speaks concretely about reading the door and sitting/walking, not “决定还是你的”. |
| 零点 R5 | Accept: remove narrator's assertion that all players already decided to inspect the route. |
| 零点 R6 | Accept: remove unsupported newspaper-delivery claim from both secret and expanded role book; retain authorship and the omitted rescue ending. |
| 天文馆 R1 | False blocker from incomplete engine description: solo/mixed AI evidence request is implemented and tested. Clarify exact deterministic ownership checks and include all seating subsets. |
| 天文馆 R2 | Accept private-feedback gap; retain secrecy. New note records an intention rather than falsely asserting a public action; shared correction moment invites actual voluntary dialogue. |
| 天文馆 R3 | Accept: replace “game safety bypass/game-outside exit” with the in-world exhibit power bypass and lit exit indication in secret, sample and role book. |
| 天文馆 R4 | Accept: second-act optional role-swapped proofreading and brightness/date comparison give a different cooperative activity without changing solutions. |
| 白夜 R1 | Accept: R3 explicitly describes a processed public copy, not an ambiguous unprocessed original. |
| 白夜 R2 | Already addressed by current DM onboarding and companion-evidence controls; packet now explains those rather than adding repeated UI instructions to 江远's speech. |
| 白夜 R3 | Accept: 苏棠's internal worry about the original replaces an author instruction not to invent deletion. |
| 校园 R1 | Export omission: the earned first return page already appears after the coordinate puzzle, including the preserved drawing and exact praise. Export and test the actual unlock, never fabricate an extra duplicate clue. |
| 校园 R2 | Existing nine relationship combinations already reject one-sided consent. Export and test the full result table; no duplicate outcome engine. |
| 校园 R3 | Accept: 裴叙 knows he placed his invitation in the bag, not which later mechanism will reveal it. |
| 校园 R4 | Accept: consistent 字格 terminology instead of 矩阵. |
| 校园 R5 | Clarify actual unlock: both return notes are publicly revealed together. Each final prompt identifies the actual pages and current respondent. |
| 威尼斯 R1 | Accept: both short biographies preserve the other pen-name owner's unknown real-world identity. |
| 威尼斯 R2 | Existing nine combinations and separate social ballot exported/tested. |
| 威尼斯 R3 | Accept: a concrete paper/coffee hesitation replaces the author directive telling the player what they need to ask. |

## Interaction and memory behavior

- Three unique optional shared moments per duet appear after the current clues and puzzle unlock. They invite reciprocal concrete conversation (drawing the cat, interpreting chairs, hearing the private sentence, choosing a feasible small plan). They are not repeated on GET or repeated solve, do not require a paid model call, do not create romance points and do not block next-act confirmation.
- A private choice receipt is visible only to its owner, including through the installed client's public-feed projection. Other players and character memory never receive it. Player speech is still required to communicate an intention.
- A new adversarial memory fixture reproduced a late corrected meeting plan being crowded out by many repeated unrelated keyword matches. Retrieval now reserves at most two latest correction/reply pairs within the unchanged 12-anchor/6,000-character budget. Reply linkage is explicit when saved; unlinked adjacent text is not claimed as agreement. Privacy filtering still happens before ranking.
- No new flashback mode, time jump, hidden consequence or automatic romance decision is introduced.

## Local verification

Passed: editorial export/validator, editorial edition integrity, optional shared moments/privacy/idempotency, current director milestones, and `test:script-rooms`, `test:script-iceland`, `test:script-campus`, `test:script-venice`, `test:script-scenes`, `test:script-conversation`, `test:role-voice`. This includes old canonical hashes, all 1–4 human journeys, both duet perspectives, nine campus/Venice relationship combinations, four Iceland relationship combinations, explicit requests, wrong answers, retry, restart, private memories, future-clue boundaries, human-speaker filtering and current-client image capability. `git diff --check` passed.

Version assertions were updated intentionally to target new rooms; old version hashes remain unchanged. A mistaken filename/glob lookup during inspection was corrected using `rg --files` and `-g`; no user data or source was changed by those failed read-only commands. User-owned `.learnings/ERRORS.md` is untouched.

## Remaining acceptance

Parent task owns second-model re-review completion, genuine provider performance, frozen-client visual proof and fresh production rollout gates. Static/model review is not proof that every possible utterance is natural, and deterministic flow tests do not prove a live model cannot fail. Recheck reviewed content hashes if any authored text changes after packets are sent.

## Second independent review and further repair

Six completed second-pass reviews in `after/reviews` requested further revision. Venice's second-pass request was incomplete and was not counted as a review. No threshold was relaxed. The corrected implementation is exported separately in `after2`; the prior packets and raw feedback remain intact.

The initial decision to treat suspect-held required evidence as merely a cooperation rule was insufficient for a murder game. A human suspect reasonably maintaining silence should not monopolize the objective's only evidence. The new, still-unpublished case editions now label their evidence as independent **public investigation copies**, with an explicit distinction from personal role secrets. Any human can actively inspect a current public record and then publish it. No inspection means no publication; future-stage material stays locked. Ordinary books and all published old editions retain their original ownership checks. Private role books, chat and mission decisions are never converted to public records.

Second-pass dispositions:

- Rain R1: shared-investigation access fixes suspect-held evidence deadlock. R2: export all 16 real open/hold combinations from `caseRelationshipOutcomes`, retaining each person's distinct intent. R3: first-stage queue now proves a planned file, while contemporaneous equipment state remains a separate card. R4: crop comparison is a separate supplemental public archive; it is not bundled into the essential reflection footage or required for the current-case gate. The photographer's personal original and explanations stay distinct from the independently sealed archive. R5: replace the cited behavioral lecture with the pause-key hesitation.
- Curtain R1: same explicit neutral-record route, without forced confession. R2: every option now supplies a different concrete private follow-up question, displayed immediately; no public claim that an unsent admission happened. R3: remove the sentence literally naming the first puzzle's answer while retaining the calibrated, independently powered log facts.
- Midnight R1: split the route information into incomplete audio, route-to-height mapping, assembly-point topology and the current open/closed notice. R2: remove repeated interface text from mission prompts and use differentiated private reflection. R3: the writer only observes the medic watching/counting, without knowing her private message. R4: opening still finds the person, but the final objective is to verify light duration, ability to walk and route before choosing the departure arrangement. R5: accept the clue-derived exact call “我们都在”; the old edition keeps its prior aliases.
- Observatory R1/R7: remove explicit engine/interface prose from new in-character books and prompts. R2/R3: remove the predeclared complete exit conclusion and narrow 白遥's starting knowledge to accessible labels. R4: different immediate private reflection for each option, not identical receipt text. R5: first puzzle now genuinely reverses the exterior clockwise ring to the interior viewpoint; starting at spring 2 yields 2413, while the fixed answer remains unchanged. R6: the review packet explicitly says this book has no romance-result mechanic.
- Iceland R1: real outcome table is complete. R2: all option consequences describe present inclination, never an automatically spoken statement. R3: add `consider` only to the new edition: still wanting the relationship but needing more time to discuss distance. All nine pairs preserve exact independent answers; any `hold` prevents a shared continuation, both open confirm distance, and open/consider or consider/consider do not invent a breakup or agreed deadline. Missing choices return unconfirmed. Published old editions remain binary.
- Campus R1: date/slow and slow/date name the willing and slower person separately, preserving the different answers. Apply the same protection to the new Venice edition. R2: remove the false “already showed/told” consequences. Neither social ballot nor other person's option overwrites consent.

`scriptDecisionPrompts.js` contains 42 scene/option-specific questions plus the third-choice variants. They are private writing/acting prompts, not automatic public dialogue or extra task gates. The UI's existing confirmation and a single DM receipt explain privacy; the character book no longer repeats that operation instruction for every option.

`test-script-editorial-round2.mjs` passes: four-human investigation progresses when one other player retrieves the suspect's required records; uninspected/future records fail closed; old-room foreign-record access remains forbidden; nine complete two-human Iceland journeys cover open/consider/hold; asymmetric campus choices are preserved; output tables include case 16 and Iceland 9 entries; every mission option has a distinct follow-up; the reversed ring is independently solved as 2413.

All previous relevant script suites pass after these changes. Two old exact-wording assertions were widened only to accept the new, more precise “未形成约会共识/未共同确认约会” wording; the new tests separately assert which named person chose date and which chose slow. Old canonical hash checks remain unchanged. No server mutation or real-device release is claimed here; `after2` still needs its independent result and parent acceptance.
