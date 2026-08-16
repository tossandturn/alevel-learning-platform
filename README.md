# A-Level Studio

A local-first Cambridge STEM, Economics and admissions-test practice platform built with React and Vite.

## Student features

- Dashboard with a persisted target, next-best action, score estimates, mastery and source-library totals.
- Verified local PDF catalog across 0580, 0606, 0625, 9231, 9701, 9702, 9708 and 9709, plus BPhO, ESAT, TMUA and AMC12 archives.
- Past-paper search by subject, year, session, document type and filename, with question-paper/mark-scheme pairing.
- PDF.js study desk with continuous long-document scrolling, zoom, download, timer, quiet autosave, a draggable desktop split and side-by-side continuous question/mark-scheme review.
- Continuous student answer sheet: A-D multiple choice, unified handwriting/typed calculation responses, written responses and unanswered-submit guard.
- On phone and iPad, a Paper / Answer sheet control switches between two independently scrollable panes, so the PDF position and current response are retained.
- Official-only topic practice with at least ten independently indexed questions, guided/practice modes, refresh-safe answers, Apple Pencil/image evidence and deterministic plus Qwen Vision marking.
- Syllabus knowledge maps for IGCSE Mathematics 0580, Additional Mathematics 0606, Physics 0625, A-Level Chemistry 9701, Physics 9702, Economics 9708, Mathematics 9709 and Further Mathematics 9231.
- Every unlocked drill is assembled from question-level QP entities bound to separate answer/MS entities. Insufficient inventory stays locked instead of being filled with generated questions.
- Append-only results, mistake review, linked chapter and PDF retests, and combined practice/PDF history. PDF blanks, pending self-marks and marks below the recorded maximum enter the Mistakes view after a self-mark review is saved.
- Local JSON data export. Student state remains in browser localStorage.

Indexed questions retain qualification, specification version, machine/review status, topic tags, paper filename, page images, local URL and SHA-256. Answers and mark points live in separate entities and are joined only through explicit bindings. The exact paired mark scheme is revealed only after submission.

## Cambridge routes

- IGCSE Mathematics 0580 uses the current Core P1+P3 or Extended P2+P4 route; papers through 2024 keep legacy labels rather than receiving invented current timing.
- IGCSE Additional Mathematics 0606 uses both current papers: P1 non-calculator and P2 calculator.
- IGCSE Physics 0625 keeps separate Core/Extended theory and Practical Test/Alternative to Practical routes.
- Physics 9702 AS uses Papers 1, 2 and 3; the A2 continuation uses Papers 4 and 5.
- Mathematics 9709 AS routes are P1+P2, P1+P4 or P1+P5. P1+P2 is AS-only. Full A Level routes are P1+P3+P4+P5 or P1+P3+P5+P6.
- Further Mathematics 9231 AS uses P1+P3 or P1+P4. The second stage adds P2 and the applied paper not taken at AS; the full route is P1+P2+P3+P4.
- Knowledge-map stage tags name the relevant components (for example AS P1, A2 P3, M1, S1 and S2) instead of using a generic AS/A2 label where the syllabus route is component-specific.
- Stage selection defaults to an exact official route. Historical 9709 P5/P6/P7 and 9702 P6 use year-aware legacy labels instead of current syllabus names.
- The library's AS/A2 filters and paper answer mode come from `src/data/examStructure.js`, with links to the current public Cambridge subject pages and syllabuses.

## Local data

The default PDF library is read from:

```text
D:\CodexWork\cie-fraft-fetcher\output\pdf
```

Override it without editing source:

```powershell
$env:CIE_LIBRARY_ROOT = 'D:\path\to\pdf'
npm run dev -- --host 127.0.0.1 --port 5173
```

Regenerate `public/data/papers.json` after the download manifest or files change:

```powershell
$env:CIE_SOURCE_ROOT = 'D:\path\to\download-output'
npm run catalog
```

The GitHub source mirror intentionally excludes the generated catalog and rendered source-page images. They are deployed with the private content release only, so verified question images and mark-scheme crops do not become repository artifacts. Run the catalog/index commands against the authorised local library before creating a fresh content release.

### Private Content Release Gate

`git archive` is code-only. Before a release can be activated, materialise the authorised `public/question-assets` and `public/data/papers.json` inside the extracted release root, then verify the release root itself. Do not regenerate or relax the source manifest on the server.

```powershell
node scripts/prepare-stem-release.mjs --release-root D:\path\to\release --assets-dir D:\authorised-content\question-assets --catalog-file D:\authorised-content\papers.json --pdf-library-root D:\authorised-content\pdf
node scripts/verify-stem-release.mjs --release-root D:\path\to\release --pdf-library-root D:\authorised-content\pdf
```

The verifier runs source-content and governed-PDF audits from the release root. It fails if private source assets, catalog, source manifest, source identity, the governed PDF library, checksums, PDF structure, source policy, withdrawal state, duplicate relationship or QP/MS association are absent or stale. The PDF library is not copied into Git; production must mount or configure the same approved private library explicitly.

Run the paper-governance audit before a content release:

```powershell
npm run papers:audit
npm run papers:audit-report
```

The report distinguishes source policy, restricted/private-study access policy, active/withdrawn/quarantined records, duplicate checksums, local file integrity, and QP-to-answer links. It intentionally does not infer a redistribution licence from an official URL or a mirror.

Index new papers at question level. Re-running the same command is idempotent; use `--all` only for an intentional historical backfill:

```powershell
npm run questions:index -- --subject 9702 --components 1,2 --papers 2
npm run questions:index -- --subject 9709 --papers 2
npm run questions:index -- --subject bpho --papers 2
npm run questions:index -- --subject 9702 --all
```

The optional server-side AI PDF importer writes only to the ignored
`data/ai-pdf-ingestion` candidate store (or `AI_PDF_INGESTION_ROOT`). It is
restricted to 9702, requires separate QP/MS evidence, and auto-quarantines
failed extraction, verification, or asset checks. `ai-verified` means the
two-pass model checks passed; it is still not a human-reviewed student
question and is never added to `unifiedQuestionBank`. Inspect the redacted
candidate contract with:

```powershell
npm run questions:ai-ingestion-status
```

Authenticated teacher/owner accounts may query the same redacted contract at
`GET /api/stem/content/ai-ingestion-candidates`. The response contains status,
source checksums, counts, and quarantine reasons only; OCR, source paths,
question payloads, and mark-scheme payloads remain server-side.

The local PDF route validates the subject and filename against a fixed subject allowlist and serves byte ranges read-only. Do not publish this project as a public past-paper host without confirming distribution rights.

## Run

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/).

For a production build on the same machine:

```powershell
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

`vite preview` also exposes the validated local PDF route.

## Qwen AI

AI Coach and handwriting marking use the same DashScope-compatible configuration pattern as IELTS-ist. Create a local `.env` from `.env.example` and set `DASHSCOPE_API_KEY`; real values remain server-side and `.env` is ignored by Git. `COACH_AI_*` and `VISION_AI_*` can override the shared key, base URL and model independently.

The default models are `qwen3.7-max` for Coach and `qwen3-vl-plus` for handwriting vision. The app stays in labeled local fallback mode when Qwen is not configured or temporarily unavailable; it does not silently switch to OpenAI.

## Verify

```powershell
npm run lint
npm test
npm run build
npm run qa:browser
```

The smoke test validates the decoupled question/answer/binding schema, deterministic and vision-assisted scoring contracts, syllabus routes and PDF pairing. Browser QA verifies a ten-question official set, correct MCQ marking, exact answer reveal, single-question mistake retest, Waves/Electricity inventory, continuous PDFs, iPad controls and 390px mobile geometry.

`npm run qa:browser` expects Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe` and `playwright-core` under `D:\CodexWork\node_modules`.

## Boundaries

- Student practice drafts and attempts are local-first. Authenticated class submissions and private route notes use the STEM shared-workspace database; drafts, handwriting evidence and Coach chats remain private to the browser unless an explicit assignment summary is submitted.
- A topic unlocks only after at least ten QP/MS-bound questions are indexed for that qualification, stage and syllabus group.
- Notebook images are compressed and stored locally as visual evidence. Automatic handwriting OCR/vision marking requires a configured vision provider; the product never claims that an image was recognized when no provider is configured.
- Notebook image blobs are stored in IndexedDB and are not included in the JSON state export. Structured PDF answer slots represent whole printed question numbers; subparts and mark allocations are not extracted automatically.
- Vision marks are assisted decisions with confidence and review status, not official Cambridge grades.
- OCR topic mapping remains visibly `machine-indexed` until a reviewer promotes the binding to `reviewed`.
