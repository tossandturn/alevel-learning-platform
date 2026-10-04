# 9700 AS Topic 11 chapter-ready candidate

Status: `PASS_CANDIDATE_NOT_DEPLOYED` (v2 source-geometry correction)

Baseline commit: `e4725ea9f86d9099c8753c91992c863fabc870a7`

## Scope and readiness

- Route: `cie-9700-as-biology`
- Official topic: `9700-as-topic-11` (Immunity)
- Official source: Cambridge 9700 2025-2027 syllabus, page 31, ten outcomes in sections 11.1 and 11.2
- Candidate: 0 formally reviewed, 6 independently AI-checked study groups, `start-study`
- Formal progress remains disabled. The 12-group formal-ready threshold is unchanged.
- All six questions are whole 2025 Paper 1 MCQs.
- This batch covers only directly mapped outcomes in the selected questions, not complete outcome or historical-paper coverage.

## Q40 geometry correction

- Root visual acceptance found the v1 second region for `cie-9700-9700_s25_qp_12:q40` started below the printed table header and omitted rows A/B.
- The corrected graph region is normalized `[0.17, 0.165, 0.82, 0.44]`, equivalent to source pixels `252,347,1221,927` on the pinned 1488x2105 page. It retains both axes, all labels, both curves, the 0-20 day scale and the time-of-injection arrow without the answer table.
- The corrected answer-table region is normalized `[0.10, 0.458, 0.69, 0.615]`, equivalent to source pixels `148,964,1027,1295`. It retains the G/H header, every A-D row, all borders and surrounding whitespace without the lower-page blank area.
- Q40 was rebound from the original full QP question crop and exact MS row, then independently reviewed once by Qwen. The other five promoted artifact files are byte-identical to v1.

## Independent verification

- Primary source review: `openai / codex-current-session`, one source-bound pass
- Independent verifier: `qwen / qwen3-vl-plus`
- Initial batch: 6 calls plus one clarification round of 3 calls
- Replacement batch: 1 call, no clarification
- Q40 geometry correction: 1 new call, no retry or clarification; 1 attempt, 60 second limit, 2500 output-token limit
- Every call used one complete QP crop and one exact MS crop, one attempt, a 60 second limit and at most 2500 output tokens.
- `reviewDecision` was strictly limited to `accept` or `block` and separated from A-D answer fields. Raw provider results are retained.
- Final clean set: 6 distinct whole Paper 1 MCQs with source identity, independent answer, exact MS answer, marks, direct official mapping and visual count passing.
- No human, teacher or official-review claim is made.

Held question remains excluded:

- `cie-9700-9700_s25_qp_14:q39`: Qwen repeatedly added the broader primary-response outcome 11.1.3 to the direct phagocyte outcome 11.1.1.

Provider receipts:

- `.candidate-evidence/9700-as-immunity-qwen-20261004-v1/`
- `.candidate-evidence/9700-as-immunity-qwen-20261004-followup1/`
- `.candidate-evidence/9700-as-immunity-replacement-qwen-20261004-v1/`
- `.candidate-evidence/9700-as-immunity-q40-geometry-qwen-20261005-v1/`
- Promotion summary: `.candidate-evidence/9700-as-immunity-promotion-20261005-v2/promotion-summary.json`

All paths above are relative to:

`D:\CodexWork\stem-chapter-ready-immunity-candidate-20261004`

## Data delta

Append this directory as a new batch. Do not replace or rewrite existing production artifact files:

`data\ai-pdf-ingestion\chapter-ready-9700-as-immunity-qwen-20261005-v2`

| Source question | Candidate SHA-256 |
| --- | --- |
| `cie-9700-9700_s25_qp_11:q40` | `609236310afe25b5f72f587a7b98d716fd11b6c493daac4af5e84282a5bd42c7` |
| `cie-9700-9700_s25_qp_13:q36` | `ac6d2de22f569c0971f346b43dd7789a0deeb7b7ceac36efda351dc0c15b5cd7` |
| `cie-9700-9700_s25_qp_14:q40` | `39ee02b3eeeca717527e2022d3422a8454b1e8f956216560ae337ab35bfd995f` |
| `cie-9700-9700_s25_qp_12:q40` | `013e2a300e6c68d8462a88bff21f32ef9d6f9539cedc21d8675b81592c2bcf6d` |
| `cie-9700-9700_s25_qp_13:q39` | `81dc4312124f75ed6c70aeea19043267555e21af9b2dda57b875f2e7b94b1a67` |
| `cie-9700-9700_s25_qp_13:q38` | `1d7abfd51db79ca5633ddc744ab0312c1382249e2084dee8cd5bc5ab598a914c` |

## Source pages and image cache

Canonical PDFs remain under `D:\CodexWork\cie-fraft-fetcher\output\pdf\9700` and the production shared PDF library. Required source pages are:

- `9700_s25_qp_11.pdf` page 15; `9700_s25_ms_11.pdf` page 3
- `9700_s25_qp_12.pdf` page 19; `9700_s25_ms_12.pdf` page 3
- `9700_s25_qp_13.pdf` pages 17 and 18; `9700_s25_ms_13.pdf` page 3
- `9700_s25_qp_14.pdf` page 17; `9700_s25_ms_14.pdf` page 3

Pinned full-page cache files:

- `page-cache\34c2bd6ddcfd82130950b636ef64126d74ca566a91183e567d632dfeae6a9b01\17-31e27f882f54a96f0e9ffaff73107379dacd6acf05a27413b3804098c77f1258.png`
- `page-cache\34c2bd6ddcfd82130950b636ef64126d74ca566a91183e567d632dfeae6a9b01\18-a022b1f2015f4a919fd6273e8ec3b3de5dd71131a59486ad1fc828a69e8ac926.png`
- `page-cache\98c1252136ef593b159a60fa6c5625ba0c8a05a16de535167f2e9c4cc18e0160\3-6285a384ab4d715a65e590d9b14c347de1d531a7350f8f3d708066ff885aa91a.png`
- `page-cache\9a0944413719077f1324b5249d1be493e2dd3fcf57993af5328112435cc9fcba\3-08ff72f2cf98f830a37e13c7400ded3dfc468bdffa9992de6c7bfbf5360454d1.png`
- `page-cache\9a0f49d4756f11960fa17b1acebd53c630f8285b5cf001afc6d540b6acbba7a3\3-f8aea74d3b9866c7ec4dfada226e3a6a08abe46382096ab2ba4457a11b68fe7a.png`
- `page-cache\b871301e28144f416cdfe4cb0ae874cd1bd73414eeae66cef67f25d0418dea51\15-df755dbc33ba8efb85e69fc076d73881c1dc0860d188921907386ec6042c4eab.png`
- `page-cache\d3213a7a142e859a632d48197446557f320f81c50bd5b881e9ead746284ad783\17-6693a433aee431cb07e307e4cda158161b2d852f4ca86c3c15f138687a5134cb.png`
- `page-cache\e6f95f47e51486f404ff5636d5dbfe9bd0e0dc3aebf4a13a0b8f358cfdd20461\19-e44d97f94d0b2b612111d9fad0e5785a99f4d06093d407fc4cc7cb2231a4a1ea.png`
- `page-cache\f1fa6fd2a88987f4fd32eb28ac0387210fed36b0aac18651fbf2ec294867f3fe\3-d89f00d4a5f2329d0ea273ebfb0382733caaad0aaa838ea503ad73ab48ebdc3e.png`

The `page-cache` paths above are relative to:

`.candidate-evidence\9700-as-immunity-promotion-20261005-v2`

## Backend and client boundary

- This is a compatible backend data/API release. Existing Mini Program 1.0.33 clients obtain the new inventory through the current authenticated APIs and do not require a development-package re-upload for this data change.
- First activation still requires the matching backend taxonomy and private objective-scoring code plus the six artifacts and page cache.
- Client feature-package work is a separate release stream and is not a prerequisite for this compatible data/API batch.

## Activation constraints

- Add only the six candidate artifacts and nine required page-cache entries.
- Use the v2 output root; do not activate the superseded v1 Q40 artifact.
- Preserve all existing production artifacts byte-for-byte.
- Keep the held receipt and excluded question out of runtime data.
- Do not mark these questions formally reviewed or formal-progress eligible.
- Run a fresh server readiness gate and Root acceptance before any upload, activation or restart.
- No student data, credentials, environment values or provider keys are part of this handoff.
