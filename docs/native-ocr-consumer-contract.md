# Native OCR consumer contract

Scope: reuse the existing paper library and reviewed OCR artifacts. Do not create a second question bank, alter original PDFs, or declare OCR completion to be student/formal readiness.

## Classification and eligibility

- Accept only valid, independently checked, explicitly released coordinate artifacts from 2017–2025 on registered academic routes. Route, subject, stage, topic, fine syllabus point, QP/MS and image bindings remain mandatory.
- Retain the production 0580 2025–2027 taxonomy. Future-syllabus artifacts need a separately reviewed target-version mapping; dropping fine point suffixes or replacing the production dictionary is not a migration.
- `getExamPaperProfile(subject, variant, year).paperNumber` is the original printed component. `courseComponent` is its supported current-course equivalent, or `null` when retired. In pre-2020 9709, original P5 is retired M2, P6 is S1/current P5, and P7 is S2/current P6. Current P7 stays ineligible.
- Pre-2020 9231 requires separate question-level curriculum review: two broad historical papers were replaced by four papers and an AS route in 2020. Its original archive remains readable, but file-number-only routing to current AS/Pure 2 is blocked. No old material is deleted and no missing mapping is invented. Source: [Cambridge's 2020–2022 syllabus changes](https://www.cambridgeinternational.org/Images/414957-2020-2022-syllabus.pdf), printed pp.47–49.
- `practicePolicy.schemaVersion=stem-topic-practice-policy-v1`: 6 source groups for released study, 12 reviewed groups per selected topic for formal practice; set sizes 6/10/15. Count/list/start/rebind use the existing policy, not a summed cross-topic total.
- Each component's `apiReadyQuestionIds` is the actual API-startable set. Raw OCR/study IDs must not inflate it. Formal, released-study, indexed and quarantined counts are distinct. Route totals are unique source IDs, not sums of topic memberships.
- The artifact limit is explicit and fail-closed. Exceeding it returns `AI_PDF_RUNTIME_ARTIFACT_LIMIT_EXCEEDED`, never an apparently complete truncated catalog.

## Original page pixels

The producer's `pageImageSha256` can identify a stored PDFium PNG, not a Poppler JPEG. Re-encoding those pixels creates a different byte hash. Never ignore that difference.

`server/nativeSourcePages.js` exports `sourcePageCachePath(spec)` and `readVerifiedSourcePage(spec)`. The private cache root is `STEM_SOURCE_PAGE_CACHE_ROOT`, defaulting to `<libraryRoot>/.source-page-cache`. File key:

```text
<PDF-SHA256>/<one-based-page>-<PNG-byte-SHA256>.png
```

Deployment copies only receipt-allowlisted original page bytes after hash/size verification. No directory-wide OCR import or regeneration is implied. The reader verifies library/cache realpath containment, PDF bytes, PNG bytes, signature/IHDR and bounded dimensions. Native display requires known dimensions. Only the internal marking path may permit a paired MS or infer dimensions from a hash-bound PNG; HTTP parameters never enable this.

`GET /api/stem/practice-source-image` accepts `routeId`, `sourceQuestionId`, `region` and the current binding digest `v`. It resolves the current released QP internally, never a client filename, arbitrary URL, MS or crop. The set response supplies `native-source-region-v1` descriptors. The Mini Program clips the normalized region using actual pixel aspect and fetches only the visible question. Shared source pages do not make their other questions approved.

AI source hydration uses the same verified PNG cache and the existing pinned `@napi-rs/canvas` to crop/encode a provider JPEG. The original PNG SHA remains `sourcePageSha256`; the derivative JPEG gets its own SHA. Queue/deadline bounds apply. An existing corrupt cache fails closed; it is not silently replaced by a rerender. Legacy JPEG-bound sources keep their original path. See the [upstream canvas API](https://github.com/Brooooooklyn/canvas) for the local Buffer decoding/encoding implementation.

## Paper catalog and scale

`native-paper-filters-v1` filters the existing complete catalog by subject/stage/route/year/season before a maximum 30-row page. Cambridge spring/summer/autumn-winter labels reflect original metadata; competition rounds/forms are not renamed as seasons. Source IDs, original component numbers, pairing, and governed file access remain unchanged.

The present syllabus response still carries ID lists for exact selection preflight. Before publishing tens of thousands of matched groups, add a compact native count projection plus server-side selection preview rather than shipping all group IDs or question objects to the client. Large OCR directories must not be activated just because the loader's capacity increased.

## Acceptance

- `npm test`, `npm run lint`, `npm run build` locally; no source compilation on production.
- `scripts/qa-native-source-handoff.mjs` verifies a pinned allowlist, stages only exact bytes in an explicit cache, checks real QP image reads, combines released items with existing reviewed questions, and exercises actual HTTP assembly plus the Mini Program validators. It does not publish or contact an AI provider.
- Display, canonical QP/MS hydration, live AI response, phone/tablet layout and production deployment are separate acceptance items. Neither a green config/status endpoint nor a screenshot proves AI marking or corpus completion.
- Source-bound live canary checked the real released QP/MS for one Space MCQ with synthetic photographed choices. D earned 1/1; B earned 0/1. Before the earned-mark contract was clarified, B twice produced `awarded=false, marks=1, rawMarks=0` and was correctly rejected. The prompt now explicitly distinguishes earned credit from available rubric weight; the validator still rejects that contradictory shape, missing fields, overmarks and unreconciled totals. This is narrow integration evidence, not a whole-bank marking-accuracy claim.
- Back up and publish code, released artifacts and page caches as separately hashed, allowlisted axes. Never replace original library or student data. A fresh server-readiness check and production smoke are required.
