# 9700 AS Topic 3 candidate

Status: `PASS_CANDIDATE_NOT_DEPLOYED`

Baseline commit: `97ae794f1b1627b361f4758094b905f663cdb77f`

## Scope

- Route: `cie-9700-as-biology`
- Official topic: `9700-as-topic-03` (Enzymes)
- Official source: Cambridge 9700 2025-2027 syllabus, printed page 20
- Taxonomy: 8 outcomes across sections 3.1 and 3.2
- Candidate: 6 independently AI-checked whole 2025 Paper 1 MCQs, study-only and `formalProgressEligible: false`

The source bridge exposes only the eight current outcomes: 3.1.1-3.1.4 and 3.2.1-3.2.4. Chapter Study can start from these six questions and the authenticated API scores all six private answers. The six true-source groups satisfy the selected student-study release floor without counting original-foundation content; formal readiness remains disabled at 0/12 reviewed groups.

## Final questions

| Source question | QP / page | MS / page | MS key | Direct official points | Candidate SHA-256 | Review receipt SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `cie-9700-9700_s25_qp_11:q15` | `9700_s25_qp_11.pdf` / 7 | `9700_s25_ms_11.pdf` / 2 | B | `3.1.2` | `c87897d2f2f2135fc6b4e63f79e533f2b7518a3de60af88ac1e3f0fac7e8cf4c` | `bac6692ba399fd0bfb94487cb341787d8c9de484fb4fe3ecd6f6c04fb6657b69` |
| `cie-9700-9700_s25_qp_11:q16` | `9700_s25_qp_11.pdf` / 7 | `9700_s25_ms_11.pdf` / 2 | C | `3.2.2` | `c15924959aadd17845bcf40318585b4b02d71d29ac883c7739f372e15d000ea3` | `fde6999b7b6270f44c14a965451a5bbcf60881d291ea99497b2d16876a6a39a9` |
| `cie-9700-9700_s25_qp_12:q13` | `9700_s25_qp_12.pdf` / 6 | `9700_s25_ms_12.pdf` / 2 | A | `3.1.1` | `003ffe1865b7ab3fb65e271be42de1b683573fd1c66ee986a7872b79519d92e3` | `830f5a612aeee1f4b1182e4dc1ce63767819ddab9f2063ac719b380d475b0d3e` |
| `cie-9700-9700_s25_qp_13:q16` | `9700_s25_qp_13.pdf` / 8 | `9700_s25_ms_13.pdf` / 2 | A | `3.2.2`, `3.2.3` | `c4b81f4c53619153d7a102d7fcf26b5b3adc4ad450164117039fceb95d5517c3` | `c90273a26ae5fc65b7b6520124aef519c1efb2cad8ad29d28cf2674cd16f7ae7` |
| `cie-9700-9700_s25_qp_14:q15` | `9700_s25_qp_14.pdf` / 8 | `9700_s25_ms_14.pdf` / 2 | C | `3.2.1` | `e4401c1523353b8ff4764f0bc64ba3f4bab4bd8e693603b2eb4e307b290877a3` | `6cf2ea61a47772c227692af1019593081161b5f3a57b749e4ace5601e91a84d2` |
| `cie-9700-9700_s25_qp_14:q16` | `9700_s25_qp_14.pdf` / 9 | `9700_s25_ms_14.pdf` / 2 | B | `3.2.2`, `3.2.3` | `eae3dfd6f128ce80e6016072cdb0f39a9dfb4cce3c7c7205ad38d9b11db5f3e1` | `ea7aa16f8a27c5996c009bb50327571866b36b0eef3fce96fc6bdc9973239d46` |

## Source PDF hashes

| Source pair | QP SHA-256 | MS SHA-256 |
| --- | --- | --- |
| `s25/11` | `b871301e28144f416cdfe4cb0ae874cd1bd73414eeae66cef67f25d0418dea51` | `9a0f49d4756f11960fa17b1acebd53c630f8285b5cf001afc6d540b6acbba7a3` |
| `s25/12` | `e6f95f47e51486f404ff5636d5dbfe9bd0e0dc3aebf4a13a0b8f358cfdd20461` | `f1fa6fd2a88987f4fd32eb28ac0387210fed36b0aac18651fbf2ec294867f3fe` |
| `s25/13` | `34c2bd6ddcfd82130950b636ef64126d74ca566a91183e567d632dfeae6a9b01` | `9a0944413719077f1324b5249d1be493e2dd3fcf57993af5328112435cc9fcba` |
| `s25/14` | `d3213a7a142e859a632d48197446557f320f81c50bd5b881e9ead746284ad783` | `98c1252136ef593b159a60fa6c5625ba0c8a05a16de535167f2e9c4cc18e0160` |

## Geometry

- `s25/11 Q16` graph: normalized `[0.20, 0.315, 0.80, 0.515]`, source pixels `297,663,1191,1085` on the pinned 1488x2105 page. Both axes, labels and curves are complete.
- `s25/13 Q16` table: normalized `[0.055, 0.135, 0.94, 0.405]`, source pixels `81,284,1399,853`. Header, A-D rows, reasons and borders are complete.
- `s25/14 Q15` table: normalized `[0.29, 0.105, 0.68, 0.32]`, source pixels `431,221,1012,674`. Header, all temperature rows and borders are complete.
- `s25/14 Q16` graph: normalized `[0.02, 0.22, 0.95, 0.49]`, source pixels `29,463,1414,1032`. Both axes, labels and all inhibitor curves are complete.
- `s25/11 Q15` and `s25/12 Q13` contain no non-text visual object. Their complete QP crops and exact MS rows were directly inspected.

## Provider budget

- Primary preparation: source-bound local review with `providerCalls: 0`.
- Independent verifier: `qwen / qwen3-vl-plus`.
- Initial blind batch: exactly 6 calls; four passed and two were held only for syllabus-point disagreement.
- Clarification batch: exactly 2 calls; both held questions passed with the original whole QP and exact MS crops.
- Replacement batch: 0 calls; work stopped immediately after six clean questions.
- Total: 8/12 authorised provider calls. Every call used two images, one attempt, a 60 second timeout and at most 2500 output tokens.
- No retry, receipt rebinding, mapping relaxation or replacement was used.

Evidence roots:

- `.candidate-evidence/9700-as-enzymes-primary-20261005-v1/`
- `.candidate-evidence/9700-as-enzymes-qwen-20261005-v1/`
- `.candidate-evidence/9700-as-enzymes-qwen-20261005-followup1/`
- Promotion summary: `.candidate-evidence/9700-as-enzymes-promotion-20261005-v1/promotion-summary.json`

Candidate data root:

`data\ai-pdf-ingestion\chapter-ready-9700-as-enzymes-qwen-20261005-v1`

It contains six artifacts and nine pinned full-page cache entries. Evidence roots remain local and uncommitted; generated catalog fixtures are ignored. Only the isolated source, bridge, integration, scripts, tests and this handoff are committed.

## Preserved baseline hashes

The existing original-foundation implementation and Chapters 1/2/8/9/10/11 source and bridge files were not edited. Their 36 existing study questions remain isolated from the six new Topic 3 questions.

| Existing file | SHA-256 |
| --- | --- |
| `server/originalFoundationPractice.js` | `e23006252c625b2491f12d7f212bd8cc1c0e7deaab0b7ca29903f3aa21f2458e` |
| `biology-9700-as-cell-structure-source.json` | `b914353013c9067ef080861f308d0a623a8a3ebe377f1e9749d9917f83d1c8ad` |
| `biology-9700-as-cell-structure-bridge.js` | `8275fbe208908b2bf7ee073117166b06a202434106448bafe193e24b0e0c161f` |
| `biology-9700-as-biological-molecules-source.json` | `6120e8c62b4d92652c9f1dab53ab593d06b1df65a484d34c99d571923a038751` |
| `biology-9700-as-biological-molecules-bridge.js` | `59a2864fbed23236517f844ce062634ae68719ad2b6bdf57969f2a5e43db37ec` |
| `biology-9700-as-mammal-transport-source.json` | `09ec424a756ea1d84be3f7dab2c6413efa682866f048247a0b37d38238c2cd5c` |
| `biology-9700-as-mammal-transport-bridge.js` | `22e9af8fdeebf2b1f46544fc5172f091e7499cd2ca61ec3268002b5b915aad09` |
| `biology-9700-as-gas-exchange-source.json` | `8d4d45a8febb735a0e45cc8b2976087e756b6398c05a0a1f3b5986385f5af190` |
| `biology-9700-as-gas-exchange-bridge.js` | `4d0e549a43a44a4afa209d789c0e04813d3caea3b33126cb72d17975971e7fa9` |
| `biology-9700-as-infectious-diseases-source.json` | `7682d16b1bb57b84ba3286fb846174e393d0544491b008ea54efcab3f7ede6cd` |
| `biology-9700-as-infectious-diseases-bridge.js` | `462199c04fe47706f96450946b0f220f41329e8943ca239048f42fbbed69109c` |
| `biology-9700-as-immunity-source.json` | `7e8746234836d9b0a2561c3e5f61dd9759949ad481f43767b0f90dbca3d08322` |
| `biology-9700-as-immunity-bridge.js` | `15f099f672c132223382d66c2a555e0991a20abcca639e216ece34e9f5d97b36` |

## Safety boundary

- No push, deployment, server mutation, OCR worker, swap action, secret access, actual database access or client upload was performed.
- Mini Program 1.0.33 remains unchanged.
- Root must independently review source evidence before any future data release.

## Verification

- `npm run test:chapter-ready-enzymes`: exit 0. The source test reports six release-eligible study groups; the authenticated API test passes 6/6 private-answer scoring, no pre-submit answer leak, 401 rejection and formal-progress false.
- `node scripts/test-ai-verified-runtime-syllabus-mapping.mjs`: exit 0, with 8 Topic 3 points, 83 disjoint current 9700 point IDs and unchanged Chapters 1/2/8/9/10/11 counts.
- Chapter 1/2/8/9/10/11 focused suites: exit 0 using their isolated local data roots.
- `npm run lint`: exit 0 with six pre-existing warnings only.
- `npm test`: exit 0.
- Baseline preservation `git diff --quiet` for original foundation and Chapters 1/2/8/9/10/11 source/bridge files: exit 0.
- Release build remains a Root-controlled phase after independent source QA; this task did not add Topic 3 to a production manifest or deploy it.
