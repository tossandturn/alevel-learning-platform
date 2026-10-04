# 9700 AS Topic 08 chapter-ready candidate

Status: `PASS_CANDIDATE_NOT_DEPLOYED`

Baseline commit: `bb70ffcf802918cf524ea7a96c4d3d85ddd99aa5`

## Scope and readiness

- Route: `cie-9700-as-biology`
- Official topic: `9700-as-topic-08` (Transport in mammals)
- Public before: 0 reviewed, 0 study, hidden
- Candidate after: 0 formally reviewed, 6 independently AI-checked study groups, `start-study`
- Formal progress remains disabled. The 12-group formal-ready threshold is unchanged.
- The six original one-pass artifacts remain unchanged. The candidate uses new copies with a bound Qwen second review.

## Independent verification

- Primary source review: `openai / codex-current-session`, one source-bound pass
- Independent verifier: `qwen / qwen3-vl-plus`
- Initial bounded pass: 6 calls, 2 images per call, 1 attempt, 60 seconds, 2500 output tokens; 3 pass and 3 held
- Clarification pass: only the 3 held questions, same limits; 3 pass
- Final result: 6/6 source identity, independently derived answer, exact MS answer, marks, direct official topic mapping and retained visual count passed
- No human, teacher or official-review claim is made.

Provider receipts:

- `D:\CodexWork\stem-chapter-ready-candidate-20261004\.candidate-evidence\9700-as-mammal-transport-qwen-20261004\`
- `D:\CodexWork\stem-chapter-ready-candidate-20261004\.candidate-evidence\9700-as-mammal-transport-qwen-20261004-followup1\`
- Promotion summary: `D:\CodexWork\stem-chapter-ready-candidate-20261004\.candidate-evidence\9700-as-mammal-transport-qwen-20261004-followup1\promotion-summary-v2.json`

## Data delta

Append this directory as a new batch. Do not replace or rewrite the existing 512 production artifact files:

`D:\CodexWork\stem-chapter-ready-candidate-20261004\data\ai-pdf-ingestion\chapter-ready-9700-as-mammal-transport-qwen-20261004-v2`

| Source question | Candidate SHA-256 |
| --- | --- |
| `cie-9700-9700_s25_qp_12:q32` | `99d368abf6bacac7d0a186a2f862837032c0aa191c9b53924d0847d7d63f310d` |
| `cie-9700-9700_s25_qp_12:q33` | `6be83675a1691be050538d914a081fa4cad16253bca8591fb995d481f3ffd63f` |
| `cie-9700-9700_s25_qp_12:q34` | `b323ad24e4a1d7591fd165f6efb0b3ca05e8fc16dad7244dc9593d3a61664867` |
| `cie-9700-9700_s25_qp_13:q32` | `5fa64232e9d857bfefc02a94928c159ffaa59964a2501599dcb8fcd531e52f80` |
| `cie-9700-9700_s25_qp_14:q32` | `3db9c73e1c9c427cd722dce011108f963239b77b49d3278c803b80cce0ac8c83` |
| `cie-9700-9700_s25_qp_14:q33` | `5194e2d1af9dec5cca2e0900eb70aa98325bec00f74475000ea332c8313f173e` |

## Source pages and image cache

Canonical PDFs remain under `D:\CodexWork\cie-fraft-fetcher\output\pdf\9700` and the production shared PDF library. Required source pages are:

- `9700_s25_qp_12.pdf` page 16; `9700_s25_ms_12.pdf` page 3
- `9700_s25_qp_13.pdf` page 15; `9700_s25_ms_13.pdf` page 3
- `9700_s25_qp_14.pdf` page 15; `9700_s25_ms_14.pdf` page 3

Pinned crop and source-page manifests:

- `D:\CodexWork\stem-ocr-work\postprocess-batches\chapter-20260930\biology-as-mammal-transport\pdf-crop-preview-manifest.json`
- `D:\CodexWork\stem-ocr-work\postprocess-batches\chapter-20260930\biology-as-mammal-transport\source-geometry.json`
- `D:\CodexWork\stem-ocr-work\postprocess-batches\chapter-20260930\biology-as-mammal-transport\crop-acceptance.json`

Pinned full-page cache files:

- `page-cache\e6f95f47e51486f404ff5636d5dbfe9bd0e0dc3aebf4a13a0b8f358cfdd20461\16-fefee498809e49aadaf1107e741445377a977f3110d116b9e2420d9dc919599b.png`
- `page-cache\f1fa6fd2a88987f4fd32eb28ac0387210fed36b0aac18651fbf2ec294867f3fe\3-d89f00d4a5f2329d0ea273ebfb0382733caaad0aaa838ea503ad73ab48ebdc3e.png`
- `page-cache\34c2bd6ddcfd82130950b636ef64126d74ca566a91183e567d632dfeae6a9b01\15-a1e2371caf09eb6bcc45668332c149304c2723e10ecc4fdd04a86c1fc7a47de2.png`
- `page-cache\9a0944413719077f1324b5249d1be493e2dd3fcf57993af5328112435cc9fcba\3-08ff72f2cf98f830a37e13c7400ded3dfc468bdffa9992de6c7bfbf5360454d1.png`
- `page-cache\d3213a7a142e859a632d48197446557f320f81c50bd5b881e9ead746284ad783\15-58cc2b82120fbd1ef956bade07aeb6b53adb83765ca780c60f7b77cc6b321160.png`
- `page-cache\98c1252136ef593b159a60fa6c5625ba0c8a05a16de535167f2e9c4cc18e0160\3-6285a384ab4d715a65e590d9b14c347de1d531a7350f8f3d708066ff885aa91a.png`

The `page-cache` paths above are relative to:

`D:\CodexWork\stem-ocr-work\postprocess-batches\chapter-20260930\biology-as-mammal-transport`

## Activation constraints

- Add only the six v2 artifact files and the required page-cache entries.
- Preserve all 512 existing production artifact files byte-for-byte.
- Do not add the full 798 combined bank or any of its 467 single-model artifacts.
- Do not mark these questions formally reviewed or formal-progress eligible.
- Run a fresh server readiness gate and Root acceptance before any upload, activation or restart.
- No student data, credentials, environment values or provider keys are part of this handoff.
