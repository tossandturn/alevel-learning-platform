# 9700 AS Topic 09 chapter-ready candidate

Status: `PASS_CANDIDATE_NOT_DEPLOYED`

Baseline commit: `e1882ccf946688fce2e48031321341a00b1fc7ee`

## Scope and readiness

- Route: `cie-9700-as-biology`
- Official topic: `9700-as-topic-09` (Gas exchange)
- Official source: Cambridge 9700 2025-2027 syllabus, page 29, seven outcomes in section 9.1
- Candidate: 0 formally reviewed, 6 independently AI-checked study groups, `start-study`
- Formal progress remains disabled. The 12-group formal-ready threshold is unchanged.
- This batch covers only the directly mapped outcomes present in the six selected questions. It does not claim complete outcome or historical-paper coverage.

## Independent verification

- Primary source review: `openai / codex-current-session`, one source-bound pass
- Independent verifier: `qwen / qwen3-vl-plus`
- Initial batch: 6 calls plus one clarification round of 3 calls
- Replacement batch: 3 calls plus one clarification round of 2 calls
- Reserve batch: 1 call, no clarification
- Every call used exactly one QP crop and one MS crop, one attempt, a 60 second limit and at most 2500 output tokens.
- Final clean set: 6 distinct whole Paper 1 MCQs with source identity, independent answer, exact MS answer, marks, direct official topic mapping and retained visual count all passing.
- No human, teacher or official-review claim is made.

Held questions remain excluded:

- `cie-9700-9700_s25_qp_11:q35`: independent reviewer repeatedly added broader background outcomes.
- `cie-9700-9700_s25_qp_12:q35`: independent reviewer repeatedly added outcome 9.1.4 to the direct 9.1.2 mapping.
- `cie-9700-9700_s25_qp_13:q35`: independent reviewer twice preferred D while the official mark scheme gives C.
- `cie-9700-9700_s25_qp_14:q36`: independent reviewer repeatedly added image-recognition outcomes to a distribution table.

Provider receipts:

- `.candidate-evidence/9700-as-gas-exchange-qwen-20261004-v1/`
- `.candidate-evidence/9700-as-gas-exchange-qwen-20261004-followup1/`
- `.candidate-evidence/9700-as-gas-exchange-replacement-qwen-20261004-v1/`
- `.candidate-evidence/9700-as-gas-exchange-replacement-qwen-20261004-followup1/`
- `.candidate-evidence/9700-as-gas-exchange-reserve-qwen-20261004-v1/`
- Promotion summary: `.candidate-evidence/9700-as-gas-exchange-promotion-20261004-v1/promotion-summary.json`

All paths above are relative to:

`D:\CodexWork\stem-chapter-ready-gas-exchange-candidate-20261004`

## Data delta

Append this directory as a new batch. Do not replace or rewrite existing production artifact files:

`data\ai-pdf-ingestion\chapter-ready-9700-as-gas-exchange-qwen-20261004-v1`

| Source question | Candidate SHA-256 |
| --- | --- |
| `cie-9700-9700_s25_qp_11:q33` | `7731a840d840ec4eca94ee5d0dd03b55eb8e91425aa9acd06db8e10ac2723e8b` |
| `cie-9700-9700_s25_qp_11:q34` | `4cfae7f2ab7fdeeb059624783d4a87e0686c1b3dfdf2776de0b3a3a7e6dc9c8f` |
| `cie-9700-9700_s25_qp_12:q36` | `64fd5f8b16399294dc34c061d5050ccae26a412e1238a3f1b1b3c7c30ff1a38c` |
| `cie-9700-9700_s25_qp_13:q34` | `dd667417b341a3de9c0e17671ef028b941c6556e851cfe5e4d22fe36f7f7088f` |
| `cie-9700-9700_w24_qp_13:q36` | `e96c95ae011cd96911045d74ddbb44a3e8db8c99623b48f594c0bfe1a8c11136` |
| `cie-9700-9700_w24_qp_11:q34` | `7fa942158f6c8f9e7779047d45d939574e7876d2457b95d79e60192f0376f8d8` |

## Source pages and image cache

Canonical PDFs remain under `D:\CodexWork\cie-fraft-fetcher\output\pdf\9700` and the production shared PDF library. Required source pages are:

- `9700_s25_qp_11.pdf` page 13; `9700_s25_ms_11.pdf` page 3
- `9700_s25_qp_12.pdf` page 17; `9700_s25_ms_12.pdf` page 3
- `9700_s25_qp_13.pdf` page 16; `9700_s25_ms_13.pdf` page 3
- `9700_w24_qp_13.pdf` page 16; `9700_w24_ms_13.pdf` page 3
- `9700_w24_qp_11.pdf` page 16; `9700_w24_ms_11.pdf` page 3

Pinned full-page cache files:

- `page-cache\34c2bd6ddcfd82130950b636ef64126d74ca566a91183e567d632dfeae6a9b01\16-08e3b7461d19b60b9ad010b9f6f1d6440b61ce146c480b010787cbba6337ddec.png`
- `page-cache\3c1541fa3365918c2f08a3acb95b39abad69718182664e74303c2b24ed656218\16-1b81cd43eac2023e47ea6a66356f86195a8ad12d3856fd340741a33a6862a35c.png`
- `page-cache\9a0944413719077f1324b5249d1be493e2dd3fcf57993af5328112435cc9fcba\3-08ff72f2cf98f830a37e13c7400ded3dfc468bdffa9992de6c7bfbf5360454d1.png`
- `page-cache\9a0f49d4756f11960fa17b1acebd53c630f8285b5cf001afc6d540b6acbba7a3\3-f8aea74d3b9866c7ec4dfada226e3a6a08abe46382096ab2ba4457a11b68fe7a.png`
- `page-cache\a8d17475a91676eefa798931337060b8d7867e4629d2375e36766022e86e07ab\3-411742166fc8c82dd1c161dcc821b695557a3811218a116d9921b6b02aa9f240.png`
- `page-cache\b871301e28144f416cdfe4cb0ae874cd1bd73414eeae66cef67f25d0418dea51\13-5f7f3024f7e8a44362898b0b4de90109b09bffc398f0927a767fc2c99339131c.png`
- `page-cache\bb0dc1203b9d48f44ce3fadfd53c254627b8d6aa34c21b3540cb328fe4436de5\16-d41a98d52f8b390432346005975a62143152d526d0d7632523a623306807ba84.png`
- `page-cache\d12179fd75363f21180f11fb38e5961c0f4707da55f650c4b2eaa07097ae49fc\3-51032b778b8d82ed61b97c8ad95e970f899cf6d8298491e4d97c776d7eb2989b.png`
- `page-cache\e6f95f47e51486f404ff5636d5dbfe9bd0e0dc3aebf4a13a0b8f358cfdd20461\17-9942f08ab512226d4ef18f97e0079177cc4b8b2eaf6d19f92d727e7722012de1.png`
- `page-cache\f1fa6fd2a88987f4fd32eb28ac0387210fed36b0aac18651fbf2ec294867f3fe\3-d89f00d4a5f2329d0ea273ebfb0382733caaad0aaa838ea503ad73ab48ebdc3e.png`

The `page-cache` paths above are relative to:

`.candidate-evidence\9700-as-gas-exchange-promotion-20261004-v1`

## Activation constraints

- Add only the six candidate artifact files and the ten required page-cache entries.
- Preserve every existing production artifact file byte-for-byte.
- Keep every held receipt and excluded question out of runtime data.
- Do not mark these questions formally reviewed or formal-progress eligible.
- Do not claim complete Chapter 9 outcome or historical-paper coverage.
- Run a fresh server readiness gate and Root acceptance before any upload, activation or restart.
- No student data, credentials, environment values or provider keys are part of this handoff.
