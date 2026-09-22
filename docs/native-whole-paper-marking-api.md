# Native whole-paper AI marking API

This API accepts one student's answer as either one PDF or an ordered image sequence, keeps every artifact private, runs an asynchronous visual review, and returns authenticated source/report PDF downloads.

All routes require the normal short-lived STEM bearer token. Resource IDs never grant access by themselves: every job, file slot, status read, retry, and download is scoped to the authenticated owner. A resource owned by another account returns `404`.

## Limits and authority

- Answer: one PDF of at most 10 MiB and 20 pages, or 1–20 PNG/JPEG/WebP images of at most 4 MiB and 12 megapixels each. Ordered images have a 60-megapixel total budget and are downscaled to a bounded PDF/vision raster while the original private uploads remain unchanged.
- Optional references: at most one question-paper PDF and one mark-scheme PDF, each at most 10 MiB and 40 pages.
- Total declared upload size: at most 40 MiB per job.
- Answer and reference documents may contribute at most 40 rendered visual pages to one provider request. The server rejects larger jobs before queueing and never drops pages silently.
- At most three draft/queued/processing jobs and 160 MiB of retained uploads per account by default.
- One worker runs at a time. Provider and total-job deadlines fail closed and retain uploaded assets for an explicit retry.
- `title` is optional and limited to 100 characters. `instructions` is optional and limited to 2,000 characters. Both are untrusted report metadata; neither enters the AI system or user prompt.
- Without an uploaded reference, the result is `ai-advisory-unscored` and all score fields are `null`.
- With an uploaded reference, any number is labelled `ai-provisional`. An uploaded reference is not promoted to an official source. `officialScore` and `formalProgressEligible` are always `false`.
- On Linux, reports containing CJK text use the fixed open-source Noto default `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc` when it exists. `STEM_WHOLE_PAPER_CJK_FONT_PATH` may explicitly override that path, and `STEM_WHOLE_PAPER_CJK_FONT_SHA256` may pin the exact font bytes. Missing, invalid, or mismatched fonts fail closed with `report_font_unavailable`; the service never copies or depends on a Windows font and never emits a known-missing-glyph PDF.

## 1. Create a draft and upload slots

`POST /api/stem/paper-marking-jobs`

```json
{
  "schemaVersion": "stem-paper-marking-job-v1",
  "clientRequestId": "stable-request-0001",
  "title": "Physics mock",
  "studentLabel": "Student A",
  "instructions": "Teacher note shown in the report only.",
  "routeId": "cie-9702-as-physics",
  "stage": "AS",
  "paperId": "optional-client-label",
  "files": [
    {
      "clientAssetId": "answer-1",
      "role": "answer",
      "mediaType": "image/jpeg",
      "order": 1,
      "fileName": "page-1.jpg",
      "size": 123456
    },
    {
      "clientAssetId": "mark-scheme",
      "role": "mark-scheme",
      "mediaType": "application/pdf",
      "order": 1,
      "fileName": "mark-scheme.pdf",
      "size": 456789
    }
  ]
}
```

The response contains server-issued `jobId` and `assetId` values. Repeating the same owner-scoped `clientRequestId` and identical metadata returns the same job with `duplicate: true`; different metadata returns `409 idempotency_conflict`.

Each status response includes resumable file metadata:

```json
{
  "jobId": "wpm-...",
  "status": "draft",
  "assets": [
    {
      "clientAssetId": "answer-1",
      "assetId": "asset-...",
      "status": "awaiting-upload",
      "fileName": "page-1.jpg",
      "uploadPath": "/api/stem/paper-marking-jobs/wpm-.../files/asset-..."
    }
  ]
}
```

## 2. Upload raw bytes

`PUT /api/stem/paper-marking-jobs/:jobId/files/:assetId`

Send the file as the raw request body with the exact declared `Content-Type` and byte length. This is compatible with Mini Program `wx.request` plus `ArrayBuffer`; it does not require `wx.uploadFile` or a separate upload domain.

The server checks content type, magic bytes, image decoding or PDF parsing, page count, byte size, and SHA-256 before committing the private file. Retrying identical bytes is idempotent. Different bytes in an already-completed slot return `409 asset_already_uploaded`.

## 3. Submit the immutable ordered job

`POST /api/stem/paper-marking-jobs/:jobId/submit`

```json
{
  "clientRequestId": "stable-request-0001",
  "answerAssetIds": ["asset-answer-1", "asset-answer-2"],
  "questionPaperAssetId": "asset-question-paper",
  "markSchemeAssetId": "asset-mark-scheme"
}
```

`answerAssetIds` must exactly match the declared answer order. Optional reference IDs must match their declared slots. Submission returns `202` with `status: "queued"`. Repeating the identical submission does not start or bill a second processing attempt. Upload bindings become immutable after submit.

## 4. List, poll, and retry

- `GET /api/stem/paper-marking-jobs?limit=20&cursor=...`
- `GET /api/stem/paper-marking-jobs/:jobId`
- `POST /api/stem/paper-marking-jobs/:jobId/retry` with `{ "clientRequestId": "stable-retry-0001" }`

Status is one of `draft`, `queued`, `processing`, `completed`, or `failed`. `progress.stage` gives a safe coarse stage. Failed jobs expose `retryable` and `failureCode`; provider failures never become fabricated zero scores. A process restart converts interrupted `processing` jobs to retryable `failed` jobs while retaining their uploaded files.

AI marking completes directly as `completed` with an immediately downloadable report; there is no teacher/examiner approval queue. `reviewRequired` remains in the structured result as a compatibility and uncertainty flag only. Student-visible report copy labels uncertain, blurred, missing, or weakly referenced items and tells the student to add clearer material and retry. It must not say that a human review is required. Missing evidence still suppresses unsupported totals, and every result remains non-official and ineligible for formal progress.

Every job includes `expiresAt`: drafts use the draft TTL, terminal jobs use the result TTL, and queued/processing jobs return `null`. A user-confirmed `POST /api/stem/paper-marking-jobs/:jobId/cancel` with `{ "clientRequestId": "stable-cancel-0001" }` changes only an unsubmitted draft to non-retryable `failed/cancelled`, releases its active-job slot, and retains uploaded files until the terminal TTL. Replaying the same cancel ID is idempotent. It does not immediately delete user work.

Completed results preserve:

- `assessmentMode`, `officialScore`, and `formalProgressEligible`;
- `provisionalScore` and `maxScore` when reference-backed;
- `reviewRequired`, `missingPages`, and `missingQuestions`;
- structured `questionResults`, visual evidence, provider/model identity, and rationale.

## 5. Authenticated PDF downloads

- `GET /api/stem/paper-marking-jobs/:jobId/source.pdf`
- `GET /api/stem/paper-marking-jobs/:jobId/report.pdf`

Both responses are `private, no-store`, require the owner bearer token, and use RFC 5987 `filename*` plus an ASCII fallback in `Content-Disposition`. The source PDF is the uploaded answer PDF or the server-composed ordered image PDF. The report always labels AI advice and any score as non-official.

For portable CJK coverage without embedding a multi-megabyte full font, report pages are rendered at high resolution and then embedded as compressed page images. Report text is therefore not selectable; completed jobs expose `reportTextSelectable: false` and the report download includes `X-STEM-Report-Text-Selectable: false`. A normal 2–4 page report is expected to stay below 3 MiB, and all reports fail closed above 10 MiB.

Artifacts live outside the public static root. Expired drafts and terminal jobs are removed by bounded retention cleanup; active jobs are never deleted by that cleanup.
