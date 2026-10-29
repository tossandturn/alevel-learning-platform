# Character-led Tavern conversations

## Change

The eight existing role identities now have original character cards, not only a short generic instruction: 阿栖, 阿岔, 栗子, 诺米, 沈照, 闻笙, 闲舟 and 星遥. Each has a distinct setting, preferences, small flaws, voice and sample exchanges. Samples are explicitly not user history. Existing authenticated histories, idempotency keys, draw receipts, images and stickers are unchanged.

Removed the detective's mandatory question per turn and the oracle roles' required conditional sentence formula. Ordinary conversation can end naturally, change topic, express a preference, or pause a story. Draw interpretation remains grounded in actual server results, with names, positions and orientations retained. AI identity is answered honestly when asked without a recurring disclaimer in everyday chat.

Tavern JSON and SSE routes use temperature 0.8 with thinking disabled and the original bounded deadline/output/recovery behavior. Academic Coach, vision, PDF, admissions, IELTS, payment and authentication routing are unchanged. More varied sampling is not an assurance against awkward wording or mistakes.

`server/tavernPresentation.js` is the shared source for server opening cues and the native remote-config publication. Existing IDs/categories/icons and all non-Tavern configuration are preserved. The candidate passes the actual frozen 1.0.73 client validator; no client bundle change is required. See the [plan and original GitHub references](plans/2026-10-30-tavern-personality.md) for provenance and reuse decisions.

## Verification

- Focused tests were first red for missing character definitions and Tavern-specific sampling, then passed. Character tests cover all eight cards, bounded prompts, immutable records, optional questions, sample/history separation and invalid IDs.
- 44 related suites pass: Coach modes/policies, JSON/SSE isolation, idempotency, empty-response recovery, media allowlists, long memory, draw identity/expiry/ownership, existing advisors and whole-paper marking. After presentation-source cleanup, the focused mode/API/card checks were rerun.
- Real configured DeepSeek, synthetic inputs only: eight-role multi-turn style tests; two draw/recall/topic-change conversations; identity, prompt-disclosure refusal and dependence boundaries. Final eight-role identity checks all returned the intended name and did not invent a user pet from example/character data. No real student chat was read or exported.
- Review caught invented weather detail, too-certain detective deductions and overly cold dependency-boundary wording. Prompt constraints and the relevant dialogues were revised and replayed. Finite tests do not prove all future generated facts or tones correct; detective stories remain casual generated entertainment, not a verified logic-puzzle bank.
- Native 1.0.73 preview displays the new eight-role catalog without changing its icon/layout implementation. A preview-only automator argument proxy could not be frozen; the test harness was corrected to parse serialized JSON inside the runtime. This was not a normal HTTP-client defect.

Detailed synthetic evidence and deployment receipts are maintained separately under `D:/CodexWork/tavern-personality-20261030/`. Native live-route and deployment results must be recorded after publication; local and direct-provider passes alone are not production acceptance. Physical phone testing is not represented by simulator QA.

## Published and accepted

Runtime commit `3fc5a5ca09406ab00ed767aaaebe4162b3c76517` is deployed as a four-file allowlisted overlay, with verified original-file backups. Gates passed before/after staging, activation and the one STEM-only restart. All four deployed hashes match the pinned Git objects. Existing runtime routing overlays and conversation-store source remain unchanged; the IELTS process PID/restart count and health remained unchanged.

Remote presentation revision `tavern-personality-v2-20261030` is published to develop, trial and release with expected-current CAS and immutable previous revisions retained. Each publication passed pre/post resource and service checks, preserved non-Tavern configuration and required no configuration-service restart. First-use oracle starters were checked not to assume an existing draw.

Production native-client acceptance used the frozen 1.0.73 package and an isolated synthetic QA account:

- Actual page submit returned a contextual banter reply plus an allowlisted original sticker; no loading/error state remained. Three short text turns took approximately 2.50 s, 1.13 s and 1.49 s in the simulator; these are samples, not a phone/network SLA or academic-photo timing.
- Re-entering the page preserved the requested nickname and drink preference. The reply accurately repeated the stated nickname, preferred drink and excluded drink without adding another fact.
- Keeper memory test completed. Tarot returned three unique matching card images, preserved upright/reversed orientation and recalled the exact prior cards. The hexagram image and subsequent name recall also matched.
- All eight final character identity probes used real DeepSeek and returned their intended name. All eight distinguished their own background/examples from absent user pet facts.
- Native screenshots cover the companion, story and oracle catalogs and an actual reply/sticker. No CSS, new icons or bundle were shipped. Physical phone, tablet, landscape and assistive-technology revalidation were not performed for this backend/presentation-only patch.
- Synthetic test runtime credentials were never exported; the pre-test native storage was restored and the synthetic runtime session removed. The user's pre-existing project configuration checksum remains unchanged.

Evidence: `acceptance.json`, `tavern-deployment-*.json`, `config-publish-*.json`, `feature-*.json`, `native-dialogue-*.json`, `live-chat.png`, `live-fortune-cards.png`, `live-story-cards.png` in the task evidence folder. `acceptance.json` records PASS with the physical-device and subjective-style limitations explicitly retained. Generated conversation remains probabilistic; this release does not claim every future wording or puzzle inference will be correct.
