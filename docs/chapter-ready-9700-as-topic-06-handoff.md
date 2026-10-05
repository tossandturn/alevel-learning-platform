# 9700 AS Topic 6 candidate

Status: `PASS_CANDIDATE_NOT_DEPLOYED`

Baseline commit: `00033cb8aba9521685e3485188e37f1d3ed9d14a`

## Scope

- Route: `cie-9700-as-biology`
- Official topic: `9700-as-topic-06` (Nucleic acids and protein synthesis)
- Official source: Cambridge 9700 2025-2027 syllabus, printed pages 24-25
- Taxonomy: 12 outcomes across sections 6.1 and 6.2
- Candidate: 6 independently AI-checked whole 2025 Paper 1 MCQs, study-only and `formalProgressEligible: false`

The source bridge exposes only the twelve current outcomes: 6.1.1-6.1.5 and 6.2.1-6.2.7. Chapter Study can start from these six questions and the authenticated API scores all six private answers. The six true-source groups satisfy the selected student-study release floor without counting original-foundation or another chapter's content; formal readiness remains disabled at 0/12 reviewed groups.

## Final questions

| Source question | QP / page | MS / page | MS key | Direct official points | Candidate SHA-256 | Review receipt SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `cie-9700-9700_s25_qp_11:q23` | `9700_s25_qp_11.pdf` / 10 | `9700_s25_ms_11.pdf` / 2 | B | `6.2.1`, `6.2.6` | `940b554ce306a830368c4f8a5a7852cff10655f4027a295d8e6eae755b448497` | `7988b4f044676e6647b90c475a36ef560f289965b5fd603390a034684c5dc041` |
| `cie-9700-9700_s25_qp_11:q24` | `9700_s25_qp_11.pdf` / 10 | `9700_s25_ms_11.pdf` / 2 | A | `6.1.3` | `8fd660c283f94149bb01b6f820389515e5d21620277ebe52a01a270cbafdb8f4` | `3106cf3a5b3dd6fb4d8caf79f9a143ce28155c27bbc4df88f77e2ece2055e872` |
| `cie-9700-9700_s25_qp_11:q25` | `9700_s25_qp_11.pdf` / 10 | `9700_s25_ms_11.pdf` / 2 | C | `6.2.5` | `b20ae444fd013a66ae18191d68fe0e3d895b68b545c4688f33b6eb0b56f17d5f` | `cb8ffb88004506683bc7d4601e49156f0541c0388c96c6c08b8e3ca1ee38dfe9` |
| `cie-9700-9700_s25_qp_13:q23` | `9700_s25_qp_13.pdf` / 11 | `9700_s25_ms_13.pdf` / 2 | C | `6.2.2`, `6.2.3` | `d5e0d5ba0541d22099207d61cbd5463229a5946fb3486d10be24ccd1bdb5e436` | `6078461fb8f9581a2aa7302c8e0d09d1f81fe0ab7fe6b9b1f338be510ffa509c` |
| `cie-9700-9700_s25_qp_14:q24` | `9700_s25_qp_14.pdf` / 12 | `9700_s25_ms_14.pdf` / 2 | A | `6.1.4` | `5906d5eb800b08e52179787c27336cce1ff19bc4955e5b816a0c1d4ec1b4c5a8` | `dc29c49506fc5c818d0523f6adc478a9c51381934299ebc2be663a65a79d8ef5` |
| `cie-9700-9700_s25_qp_14:q26` | `9700_s25_qp_14.pdf` / 13 | `9700_s25_ms_14.pdf` / 2 | D | `6.2.5` | `aca0f886e7fa985453495bacad64428fdfa0aa5cb23590fc71044441e4beccf8` | `9232ba4d2a1cff969b1380c36290491ec860fea4f6fc2101f6e4a9b4e632f6fa` |

## Source PDF hashes

| Source pair | QP SHA-256 | MS SHA-256 |
| --- | --- | --- |
| `s25/11` | `b871301e28144f416cdfe4cb0ae874cd1bd73414eeae66cef67f25d0418dea51` | `9a0f49d4756f11960fa17b1acebd53c630f8285b5cf001afc6d540b6acbba7a3` |
| `s25/13` | `34c2bd6ddcfd82130950b636ef64126d74ca566a91183e567d632dfeae6a9b01` | `9a0944413719077f1324b5249d1be493e2dd3fcf57993af5328112435cc9fcba` |
| `s25/14` | `d3213a7a142e859a632d48197446557f320f81c50bd5b881e9ead746284ad783` | `98c1252136ef593b159a60fa6c5625ba0c8a05a16de535167f2e9c4cc18e0160` |

## Geometry

- `s25/11 Q25` answer table: normalized `[0.11, 0.535, 0.59, 0.72]`, source pixels `163,1126,878,1516` on the pinned 1488x2105 page. Both headers, all A-D rows and borders are complete.
- `s25/14 Q24` replication table: normalized `[0.11, 0.29, 0.55, 0.50]`, source pixels `163,610,819,1053`. Both full headers, all A-D rows and borders are complete.
- `s25/14 Q26` transcription/splicing diagram: normalized `[0.12, 0.10, 0.88, 0.40]`, source pixels `178,210,1310,842`. P, Q, R, S, both strands, removed segments and the processed transcript are complete.
- The other three final questions contain no non-text visual object. Their complete QP crops and exact MS rows were directly inspected.
- Superseded primary v1-v3 coordinate-audit roots were never sent to promotion.

## Provider budget

- Primary preparation: source-bound local review with `providerCalls: 0`.
- Independent verifier: `qwen / qwen3-vl-plus`.
- Initial blind batch: exactly 6 calls; four passed and two were held only for direct syllabus-point-set disagreement.
- Clarification batch: exactly 2 calls; both held questions passed after source-conservative mapping clarification.
- Replacement batch: 0 calls. Work stopped immediately after six clean questions.
- Total: 8/12 authorised provider calls. Every call used one complete QP crop and one exact MS crop, one attempt, a 60 second timeout and at most 2500 output tokens.
- No retry, receipt rebinding, answer relaxation or gate reduction was used.

Evidence roots:

- `.candidate-evidence/9700-as-nucleic-acids-primary-20261005-v4/`
- `.candidate-evidence/9700-as-nucleic-acids-qwen-20261005-v1/`
- `.candidate-evidence/9700-as-nucleic-acids-qwen-20261005-followup1/`
- Promotion summary: `.candidate-evidence/9700-as-nucleic-acids-promotion-20261005-v1/promotion-summary.json`

Candidate data root:

`data\ai-pdf-ingestion\chapter-ready-9700-as-nucleic-acids-qwen-20261005-v1`

It contains six artifacts and seven pinned full-page cache entries. Evidence roots remain local and uncommitted; generated candidate data is ignored. Only the isolated source, bridge, integration, scripts, tests and this handoff are committed.

## Preserved baseline hashes

The original-foundation implementation and Chapters 1/2/3/4/8/9/10/11 source and bridge files were not edited. Their 48 existing study questions remain isolated from the six new Topic 6 questions.

| Existing file | SHA-256 |
| --- | --- |
| `server/originalFoundationPractice.js` | `e23006252c625b2491f12d7f212bd8cc1c0e7deaab0b7ca29903f3aa21f2458e` |
| `biology-9700-as-cell-structure-source.json` | `b914353013c9067ef080861f308d0a623a8a3ebe377f1e9749d9917f83d1c8ad` |
| `biology-9700-as-cell-structure-bridge.js` | `8275fbe208908b2bf7ee073117166b06a202434106448bafe193e24b0e0c161f` |
| `biology-9700-as-biological-molecules-source.json` | `6120e8c62b4d92652c9f1dab53ab593d06b1df65a484d34c99d571923a038751` |
| `biology-9700-as-biological-molecules-bridge.js` | `59a2864fbed23236517f844ce062634ae68719ad2b6bdf57969f2a5e43db37ec` |
| `biology-9700-as-enzymes-source.json` | `864e864f7b2540b5c0d3f02a3bd6989888686fa6b123b5117076eac8860c1c81` |
| `biology-9700-as-enzymes-bridge.js` | `67a0eb9f0ad3ccfdc8e36b1aaa9ebd76bf88fad2818804cf1050f8caca6085e8` |
| `biology-9700-as-cell-membranes-source.json` | `bc0872f0727b04cbf6d4cd9804548892cd673a6ccae173e81e98a3fd58b4073a` |
| `biology-9700-as-cell-membranes-bridge.js` | `cbe69793aa7683dfd880410ab4b3dab7fa9995c8faa279346a5e8131e1b482a6` |
| `biology-9700-as-mammal-transport-source.json` | `09ec424a756ea1d84be3f7dab2c6413efa682866f048247a0b37d38238c2cd5c` |
| `biology-9700-as-mammal-transport-bridge.js` | `22e9af8fdeebf2b1f46544fc5172f091e7499cd2ca61ec3268002b5b915aad09` |
| `biology-9700-as-gas-exchange-source.json` | `8d4d45a8febb735a0e45cc8b2976087e756b6398c05a0a1f3b5986385f5af190` |
| `biology-9700-as-gas-exchange-bridge.js` | `4d0e549a43a44a4afa209d789c0e04813d3caea3b33126cb72d17975971e7fa9` |
| `biology-9700-as-infectious-diseases-source.json` | `7682d16b1bb57b84ba3286fb846174e393d0544491b008ea54efcab3f7ede6cd` |
| `biology-9700-as-infectious-diseases-bridge.js` | `462199c04fe47706f96450946b0f220f41329e8943ca239048f42fbbed69109c` |
| `biology-9700-as-immunity-source.json` | `7e8746234836d9b0a2561c3e5f61dd9759949ad481f43767b0f90dbca3d08322` |
| `biology-9700-as-immunity-bridge.js` | `15f099f672c132223382d66c2a555e0991a20abcca639e216ece34e9f5d97b36` |

## Safety boundary

- No push, deployment, SSH, server mutation, OCR worker, secret access, actual database access or client upload was performed.
- Production and Mini Program artifacts remain unchanged.
- Root must independently review source evidence before any future data release.

## Verification

- `npm run test:chapter-ready-nucleic-acids`: exit 0. The source test reports six release-eligible study groups; the authenticated API test passes 6/6 private-answer scoring, no pre-submit answer leak, 401 rejection and formal-progress false.
- `node scripts/test-ai-verified-runtime-syllabus-mapping.mjs`: exit 0, with 12 Topic 6 points, 105 disjoint current 9700 point IDs and unchanged prior chapter counts.
- Chapter 1/2/3/4/8/9/10/11 focused suites: exit 0 using their isolated local data roots.
- `npm run lint`: exit 0 with six pre-existing warnings only.
- `npm test`: exit 0.
- Baseline preservation `git diff --quiet` for original foundation and Chapters 1/2/3/4/8/9/10/11 source/bridge files: exit 0.
- Release build remains a Root-controlled phase after independent source QA; this task did not add Topic 6 to a production manifest or deploy it.
