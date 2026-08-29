# Local PaddleOCR-VL staging contract

This directory owns only local OCR enumeration, execution state, and staging
artifacts. It does not own runtime loading, release approval, syllabus/topic
approval, or provider credentials.

## Commands

Use the isolated GPU environment already provisioned for PaddleOCR:

```powershell
$python = 'D:\CodexWork\paddle-qwen-alevel-pilot-20260828\venv-gpu\Scripts\python.exe'
$runner = 'D:\CodexWork\alevel-learning-platform\scripts\paddle-ocr\runner.py'

& $python $runner manifest --pdf-root 'D:\CodexWork\cie-fraft-fetcher\output\pdf' --work-root 'D:\CodexWork\stem-ocr-work'
& $python $runner dry-run --pdf-root 'D:\CodexWork\cie-fraft-fetcher\output\pdf' --work-root 'D:\CodexWork\stem-ocr-work'
& $python $runner status --work-root 'D:\CodexWork\stem-ocr-work'
& $python 'D:\CodexWork\alevel-learning-platform\scripts\paddle-ocr\worker.py' --work-root 'D:\CodexWork\stem-ocr-work' --device 'gpu:0'
```

For a bounded GPU smoke test, add `--max-jobs 1 --max-pages 1`. A later `run`
without those limits resumes the same job from its per-page state.

## Selection contract

Only 2021 through 2025 papers with an exact same-directory `_qp_` to `_ms_`
filename substitution are queued.

| Subject | Components |
| --- | --- |
| 9702 | 1, 2, 4; components 3 and 5 are excluded |
| 9709 | 1 through 6; candidate route IDs follow the registered combination routes |
| 0580 | 1 through 4 |
| 0625 | 2 only |

Route bindings are candidate route scopes, not syllabus approval or release
approval. Every route binding has `reviewStatus: pending_official_review` and
`routeResolutionStatus: candidate_requires_adapter_validation`.

For 9709, the runner does not emit the old generic placeholders
`cie-9709-as-mathematics` or `cie-9709-a2-mathematics`. It emits registered
candidate route IDs for the current route model:

- P1: `cie-9709-as-p1-p2`, `cie-9709-as-p1-p4`, `cie-9709-as-p1-p5`
- P2: `cie-9709-as-p1-p2`
- P3: `cie-9709-a2-after-p1-p5-p3-p4`,
  `cie-9709-a2-after-p1-p5-p3-p6`,
  `cie-9709-a2-after-p1-p4-p3-p5`
- M1/P4: `cie-9709-as-p1-p4`,
  `cie-9709-a2-after-p1-p5-p3-p4`
- S1/P5: `cie-9709-as-p1-p5`,
  `cie-9709-a2-after-p1-p4-p3-p5`
- S2/P6: `cie-9709-a2-after-p1-p5-p3-p6`

The adapter still must validate those candidates against `routeRegistry` and
the official syllabus before creating any runtime or released route binding.

## Work-root interfaces

All generated state lives under `D:\CodexWork\stem-ocr-work`, outside the Git
repository and outside `data/ai-pdf-ingestion`.

### Manifest and OCR queue

- `manifest/manifest.json`: immutable-input snapshot, selection policy, counts,
  exclusions, SHA-256 bindings, page counts, and all jobs.
- `queue/ocr-jobs.jsonl`: one `stem-paddle-ocr-job.v1` object per exact QP/MS
  pair. `jobId` is derived from paper ID and both PDF hashes, not local paths.
- `manifest/exclusions.jsonl`: non-secret diagnostics for excluded candidates.
- `logs/events.jsonl`: append-only JSON events for worker, job, and page progress.

Regenerating the manifest replaces the manifest and queue atomically but does
not replace a matching job's existing state.

### Per-job recovery state

- `state/jobs/<jobKey>.json`: one `stem-paddle-ocr-job-state.v1` object per job.
- QP and MS have independent `pending`, `running`, `partial`, `completed`, or
  `quarantined` state and per-page output records.
- A page is skipped on resume only when its source image, Markdown, and raw JSON
  still exist and match their recorded hashes.

State and queue writes use UTF-8 temporary files plus `os.replace`.

### OCR staging artifacts

- `artifacts/staging/<paperId>/<jobKey>/artifact.json`
- `ocr/<jobKey>/{qp,ms}/pages/<page>/source-page.png`
- `ocr/<jobKey>/{qp,ms}/pages/<page>/paddle-result.json`
- `ocr/<jobKey>/{qp,ms}/pages/<page>/page.md`
- `ocr/<jobKey>/{qp,ms}/pages/<page>/layout-blocks.json`
- Page-local Markdown images and Paddle visualizations are retained and hashed.

Page layout blocks retain pixel bounding boxes and normalized page regions.
The source page render records width, height, DPI, and SHA-256.

An OCR-complete staging artifact still has:

```json
{
  "status": "ocr-complete-pending-review",
  "reviewStatus": "pending_ai_structure_review",
  "syllabusBinding": { "status": "pending_official_review" },
  "questionGroups": [],
  "studentStudyEligible": false,
  "formalProgressEligible": false
}
```

### Provider-review handoff

`queue/structure-review.jsonl` receives one row only after both QP and MS OCR
finish. Two independent Codex GPT passes must review whole-question boundaries,
question-part structure, exact question-level QP/MS binding, diagram integrity,
and official syllabus/topic binding. This OCR runner does not call the review
provider.

The runtime/release task may consume a staging artifact only through its own
validation and release gate. It must never interpret queue presence or OCR
completion as approval.

### Quarantine

Failures are written to
`artifacts/quarantine/<paperId>/<jobKey>/failure.json`. The public error record
contains an error type and redacted message, never a traceback, credential, or
provider request. Quarantined jobs remain ineligible for student study.

## Non-negotiable invariants

- No official OCR API or API token is used by this runner.
- No file under `data/ai-pdf-ingestion` is read as an approval source or written.
- OCR output never sets `studentStudyEligible` or `formalProgressEligible` true.
- Topic IDs stay empty until official syllabus review completes.
- A failed or incomplete document cannot enter the structure-review queue.
