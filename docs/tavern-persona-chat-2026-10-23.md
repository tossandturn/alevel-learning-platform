# Continuous oracle-persona conversation

## Root cause and correction

The native oracle modes replaced the chat composer with a draw/interpret form. The API also required a current draw receipt for every message from those personas, so normal conversation could not begin and an expired receipt blocked follow-ups. The initial focused tests reproduced both the ignored input and HTTP 409 before implementation.

`eastern-oracle` and `tarot-reader` now remain server-owned conversational personalities before and after a reading. A missing draw ID means ordinary chat, not a request to invent a result. Explicit draw IDs still undergo the existing account/persona/receipt/expiry validation. Client-supplied cards, custom prompts, academic context, active-exam access and other-account data remain rejected.

For stateful follow-ups, the latest actual `draw_json` already recorded in the authenticated conversation is retrieved privately as historical context. Cards, positions and orientations survive receipt expiry and store restart. Historical context is explicitly not a new draw and is used only when relevant. Clearing the conversation removes access to that historical draw. This uses the existing store schema; no migration or provider/key/configuration change is needed.

The prompts support ordinary interests, short follow-up answers and topic changes without repeating the opening or forcing a complete reading. They retain fictional-AI identity and entertainment-only boundaries, prohibit fabricated draws and consequential predictions, and discourage invented facts about the user. Model wording is probabilistic; finite QA is not a guarantee of every future response.

## Verification

Evidence: `D:/CodexWork/tavern-persona-20261023/`.

- `backend-suite-result.json`: 18 suites covering curated modes, divination, stateful memory, JSON/SSE, DeepSeek routing, media, draw assets, answer policy and existing Coach conversations.
- Added API regressions: no-draw conversation; expired draw plus new chat in JSON and SSE; three-card name/position/orientation continuity; persistence after reopening the store; account/persona isolation; deletion prevents old cards entering a fresh conversation. Expired explicit new interpretation remains rejected.
- Client regressions cover chat/draw/chat, idempotent chat retry without redraw, expired result, private draft restoration, next-spread choice preserving the displayed result, and release of the loading state when stale completion is rejected.
- `live-model-result.json`: eight synthetic questions against the existing configured DeepSeek provider, including initial chat, actual trusted draw, exact card/hexagram recall and switching to ordinary conversation. The two targeted recall replies correctly identified the second tarot card/orientation and the prior hexagram. No real student conversation or credential is exported or persisted.
- Native UI tests use labelled synthetic responses and real native inputs/buttons; they do not impersonate production model acceptance. Responsive replay covers phone/tablet, portrait/landscape, reduced motion, keyboard-height and 2x-font cases. Physical hardware remains unverified.

GitHub-first reference: [SillyTavern](https://github.com/SillyTavern/SillyTavern) for character-led continuous chat. No AGPL code, dependency or imported role card was copied. Existing native controls and server conversation storage are reused.

## Release scope

Only four runtime modules are changed: `server/aiApi.js`, `server/coachFeatures.js`, `server/tavernDivination.js`, `server/tavernConversationStore.js`. The planned deployment is a pinned, allowlisted code overlay with exact previous-file hashes, verified code rollback, fresh server gates and restart of the STEM service only. No production build, installation, database migration, model switch, payment, question-bank, university-data or IELTS change. Record actual deployment results separately; local PASS alone is not a production release.
