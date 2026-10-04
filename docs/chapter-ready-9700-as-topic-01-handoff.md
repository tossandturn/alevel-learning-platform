# 9700 AS Topic 1 chapter-ready candidate

Status: `PASS_CANDIDATE_NOT_DEPLOYED`

Baseline commit: `bd4650885497143e7cafb97f57bd943127025a95`

## Scope and readiness

- Route: `cie-9700-as-biology`
- Official topic: `9700-as-topic-01` (Cell structure)
- Official source: Cambridge 9700 2025-2027 syllabus, printed pages 15-16, twelve outcomes in sections 1.1 and 1.2
- Candidate: 0 formally reviewed, 6 independently AI-checked study groups, `start-study`
- Chapter Study may start from one complete eligible question and caps requests to actual availability. Legacy Topic Drill still has a six-question floor; formal readiness remains 12 reviewed groups.
- All six questions are whole 2025 Paper 1 MCQs. Formal progress remains disabled.

## Final questions

| Source question | MS key | Direct official point IDs | Candidate SHA-256 |
| --- | --- | --- | --- |
| `cie-9700-9700_s25_qp_11:q1` | C | `1.1.3`, `1.1.4`, `1.1.5` | `4c225c1cc0ec4229a5a17ecbef6271a83b48dbcefde30025001545f97233bd81` |
| `cie-9700-9700_s25_qp_11:q2` | B | `1.1.3` | `40ef83ef0df142581fbe5fbd33adddf1aec85c71b79a0e7777c544b240ad75b6` |
| `cie-9700-9700_s25_qp_12:q2` | B | `1.1.5` | `da7e6b2fd320926176111444a84f20743214c39934054f9c1bf5da433710f3ff` |
| `cie-9700-9700_s25_qp_13:q3` | C | `1.1.5` | `8e355db06ef20bf097a44b6265df352d17433dda8e96731f132ef4645e4b92bf` |
| `cie-9700-9700_s25_qp_14:q2` | C | `1.1.3` | `9593bf62d0f1c7379727697911d7fbefb8e28dd9fbbe61476005b5a42496fa95` |
| `cie-9700-9700_s25_qp_14:q4` | A | `1.2.1` | `b82cf3ebce2c7f9aa28af776cfaa151995289d77294f0198ebe287b0cca3bd19` |

## Source geometry

- `s25/13 Q3` table and key: normalized `[0.055, 0.155, 0.78, 0.31]`, source pixels `81,326,1161,653` on the pinned 1488x2105 PNG. Header, A-D rows, key and borders are complete.
- `s25/14 Q2` cell and scale bar: normalized `[0.34, 0.35, 0.64, 0.523]`, source pixels `505,736,953,1101`. Cell outline, diameter Y, scale bar Z and labels are complete without adjacent question text.
- The remaining four final questions have no non-text visual object. Their whole-question QP crops and exact MS rows were inspected directly.
- Primary v1 failed before route taxonomy attachment. Primary v2 passed loading but visual-region QA found clipped source metadata. Both roots are retained as failed evidence; primary v3 is canonical.

## Independent verification

- Primary source review: `openai / codex-current-session`, one source-bound pass
- Independent verifier: `qwen / qwen3-vl-plus`
- Initial blind batch: 6 calls
- Clarification batch: exactly 3 calls, the permitted maximum
- Replacement candidates: exactly 3 questions, one call each and no clarification
- Every call used one complete QP crop and one exact MS crop, one attempt, a 60 second limit and at most 2500 output tokens.
- `reviewDecision` was separated from the A-D answer fields. Raw provider results and telemetry are retained.

Held questions remain excluded:

- `cie-9700-9700_s25_qp_11:q5`: independent mapping expanded beyond the pinned direct comparison outcome.
- `cie-9700-9700_s25_qp_13:q7`: independent reviewer continued to count the printed answer table differently after the single clarification.
- `cie-9700-9700_s25_qp_13:q4`: replacement review disagreed with the pinned direct official mapping.

Evidence roots, relative to this worktree:

- `.candidate-evidence/9700-as-cell-structure-primary-20261005-v3/`
- `.candidate-evidence/9700-as-cell-structure-qwen-20261005-v1/`
- `.candidate-evidence/9700-as-cell-structure-qwen-20261005-followup1/`
- `.candidate-evidence/9700-as-cell-structure-replacement-primary-20261005-v1/`
- `.candidate-evidence/9700-as-cell-structure-replacement-qwen-20261005-v1/`
- `.candidate-evidence/9700-as-cell-structure-replacement2-primary-20261005-v1/`
- `.candidate-evidence/9700-as-cell-structure-replacement2-qwen-20261005-v1/`
- Promotion summary: `.candidate-evidence/9700-as-cell-structure-promotion-20261005-v1/promotion-summary.json`

## Data delta

Append this new batch without replacing any existing chapter data:

`data\ai-pdf-ingestion\chapter-ready-9700-as-cell-structure-qwen-20261005-v1`

The promotion evidence contains nine pinned full-page cache files: five QP pages and four MS pages. Existing original-foundation content and Chapters 8-11 source files were not edited.

Preserved baseline SHA-256 snapshot:

| Existing file | SHA-256 |
| --- | --- |
| `server/originalFoundationPractice.js` | `e23006252c625b2491f12d7f212bd8cc1c0e7deaab0b7ca29903f3aa21f2458e` |
| `biology-9700-as-mammal-transport-source.json` | `09ec424a756ea1d84be3f7dab2c6413efa682866f048247a0b37d38238c2cd5c` |
| `biology-9700-as-mammal-transport-bridge.js` | `22e9af8fdeebf2b1f46544fc5172f091e7499cd2ca61ec3268002b5b915aad09` |
| `biology-9700-as-gas-exchange-source.json` | `8d4d45a8febb735a0e45cc8b2976087e756b6398c05a0a1f3b5986385f5af190` |
| `biology-9700-as-gas-exchange-bridge.js` | `4d0e549a43a44a4afa209d789c0e04813d3caea3b33126cb72d17975971e7fa9` |
| `biology-9700-as-infectious-diseases-source.json` | `7682d16b1bb57b84ba3286fb846174e393d0544491b008ea54efcab3f7ede6cd` |
| `biology-9700-as-infectious-diseases-bridge.js` | `462199c04fe47706f96450946b0f220f41329e8943ca239048f42fbbed69109c` |
| `biology-9700-as-immunity-source.json` | `7e8746234836d9b0a2561c3e5f61dd9759949ad481f43767b0f90dbca3d08322` |
| `biology-9700-as-immunity-bridge.js` | `15f099f672c132223382d66c2a555e0991a20abcca639e216ece34e9f5d97b36` |

## Backend and client boundary

- This is a compatible backend data/API release. Existing Mini Program 1.0.33 clients use the current authenticated APIs; no client package change is required for this data batch.
- Activation requires the Cell structure taxonomy bridge, private objective scoring, six artifact files and nine page-cache files.
- Do not add the three held questions, failed primary roots, or blocked receipts to runtime data.
- Run a fresh server readiness gate and Root acceptance before any upload, activation or restart.
- No credentials, environment values, provider keys, student data or private answer keys belong in Git.

## Verification

- `npm run test:chapter-ready-cell-structure`: PASS, six private-answer scores, no pre-submit answer leak, unauthenticated request rejected, formal progress false.
- `node scripts/test-ai-verified-runtime-syllabus-mapping.mjs`: PASS, 12 Cell structure points plus unchanged Chapters 8-11 point counts and disjoint IDs.
- Chapter 8, 9, 10 and 11 focused suites: PASS using their external candidate data roots.
- `npm run test:chapter-independent-start`: PASS for 22 routes and 222 independently startable chapters; this static-bank check still reports 34 chapters with official questions and 188 official gaps because candidate data is not activated globally.
- `npm run lint`: exit 0 with pre-existing warnings only.
- `npm test`: exit 0 after copying the ignored paper catalog and question-asset fixtures into the isolated worktree.
- Detached `npm run build:student-study` with the five Chapter 1/8/9/10/11 data batches: exit 0; Vite and production-route checks passed.
- Detached strict `npm run build`: exit 1 at the unchanged formal coverage gate because `physics-9702-topic-01` has 11 reviewed groups and requires 12.
- No push, deployment, server mutation, OCR worker, swap action or client upload was performed.
