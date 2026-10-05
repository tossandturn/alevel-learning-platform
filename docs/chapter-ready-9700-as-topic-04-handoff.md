# 9700 AS Topic 4 candidate

Status: `PASS_CANDIDATE_NOT_DEPLOYED`

Baseline commit: `207538d442bdb68fa2f80c162d42defd10136a0f`

## Scope

- Route: `cie-9700-as-biology`
- Official topic: `9700-as-topic-04` (Cell membranes and transport)
- Official source: Cambridge 9700 2025-2027 syllabus, printed pages 21-22
- Taxonomy: 10 outcomes across sections 4.1 and 4.2
- Candidate: 6 independently AI-checked whole 2025 Paper 1 MCQs, study-only and `formalProgressEligible: false`

The source bridge exposes only the ten current outcomes: 4.1.1-4.1.4 and 4.2.1-4.2.6. Chapter Study can start from these six questions and the authenticated API scores all six private answers. The six true-source groups satisfy the selected student-study release floor without counting original-foundation or another chapter's content; formal readiness remains disabled at 0/12 reviewed groups.

## Final questions

| Source question | QP / page | MS / page | MS key | Direct official points | Candidate SHA-256 | Review receipt SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `cie-9700-9700_s25_qp_11:q17` | `9700_s25_qp_11.pdf` / 7 | `9700_s25_ms_11.pdf` / 2 | D | `4.1.1` | `86ba3e257d2c139969ab62831ecdacff781a4cc34c9dd759285b50c3c8613769` | `33c56dbc34d601773538a4c59e8eed3a9abf00fa1fd2b4b692235b2bd60f6731` |
| `cie-9700-9700_s25_qp_11:q18` | `9700_s25_qp_11.pdf` / 8 | `9700_s25_ms_11.pdf` / 2 | B | `4.2.6` | `77a1505bdcd55ea51e86fd97e607ad30d2c0d18ab43031cb864e95c2dd46ad27` | `67b6f68b05abbaea05c0b8a4b36287a1d7fad4f2a4d4cb17e169ecae5e9e406e` |
| `cie-9700-9700_s25_qp_12:q19` | `9700_s25_qp_12.pdf` / 9 | `9700_s25_ms_12.pdf` / 2 | A | `4.2.5`, `4.2.6` | `6c45434cb2df56f96ccb3fa81c4395b347ceb97da0484769cc868f080e60587a` | `1d1d3e361e1394a593c9fa303d5df93eb8f31e43921dfa3d29c90b876ba83583` |
| `cie-9700-9700_s25_qp_12:q20` | `9700_s25_qp_12.pdf` / 10 | `9700_s25_ms_12.pdf` / 2 | D | `4.2.3`, `4.2.4` | `f0e4474a61b9cac854065a60a7507de53be492ee2a1585a3f455cbf7865a91ab` | `22c336c6fec38e8e63764d082504d713745e1a0ec820ff5f8b30142034dd8448` |
| `cie-9700-9700_s25_qp_14:q17` | `9700_s25_qp_14.pdf` / 9 | `9700_s25_ms_14.pdf` / 2 | D | `4.2.1` | `107027601f840abc1c50a64a54d7c9fec898e2a95e60d5285b1fba065b7a43eb` | `ae8da3a56856caa4f0d1706613bba20b62a2d3a235570cc30d09aea43a65e175` |
| `cie-9700-9700_s25_qp_14:q18` | `9700_s25_qp_14.pdf` / 10 | `9700_s25_ms_14.pdf` / 2 | C | `4.2.1` | `96a9c53c2046befaea6288ca6668dee4ac69793f28c4677e6a8d864c2474f676` | `bf6bac5b5ecb35e6933f455c1a122cc09b339900066fd924ba4b557e8a52b0ee` |

## Source PDF hashes

| Source pair | QP SHA-256 | MS SHA-256 |
| --- | --- | --- |
| `s25/11` | `b871301e28144f416cdfe4cb0ae874cd1bd73414eeae66cef67f25d0418dea51` | `9a0f49d4756f11960fa17b1acebd53c630f8285b5cf001afc6d540b6acbba7a3` |
| `s25/12` | `e6f95f47e51486f404ff5636d5dbfe9bd0e0dc3aebf4a13a0b8f358cfdd20461` | `f1fa6fd2a88987f4fd32eb28ac0387210fed36b0aac18651fbf2ec294867f3fe` |
| `s25/14` | `d3213a7a142e859a632d48197446557f320f81c50bd5b881e9ead746284ad783` | `98c1252136ef593b159a60fa6c5625ba0c8a05a16de535167f2e9c4cc18e0160` |

## Geometry

- `s25/12 Q19` osmosis graph: normalized `[0.18, 0.10, 0.80, 0.40]`, source pixels `267,210,1191,842` on the pinned 1488x2105 page. Both axes, all labels, plotted points and the curve are complete.
- `s25/12 Q20` agar cubes: normalized `[0.10, 0.105, 0.90, 0.31]`, source pixels `148,221,1340,653`. All three cubes and every dimension label are complete.
- The other four final questions contain no non-text visual object. Their complete QP crops and exact MS rows were directly inspected.
- Superseded coordinate-audit roots for Q12/18 and the early Q14/18 crops were never sent to promotion.

## Provider budget

- Primary preparation: source-bound local review with `providerCalls: 0`.
- Independent verifier: `qwen / qwen3-vl-plus`.
- Initial blind batch: exactly 6 calls; three passed and three were held.
- Clarification batch: exactly 3 calls; Q12/20 passed, Q12/17 remained blocked and Q12/18 failed provider/schema validation without retry.
- Replacement batch: exactly 2 calls; Q14/17 and Q14/18 both passed on the first attempt.
- Total: 11/12 authorised provider calls. Work stopped immediately after six clean questions, leaving one replacement call unused.
- Every provider call used one complete QP crop and one exact MS crop, one attempt, a 60 second timeout and at most 2500 output tokens.
- No retry, receipt rebinding, answer relaxation or gate reduction was used.

Held questions remain excluded:

- `cie-9700-9700_s25_qp_12:q17`: the independent model continued to derive B while the exact official MS row gives A.
- `cie-9700-9700_s25_qp_12:q18`: the initial review disagreed on retained visual count and direct point set; its one clarification call then failed provider/schema validation. It was replaced rather than retried.

Evidence roots used for the final candidate:

- `.candidate-evidence/9700-as-cell-membranes-primary-20261005-v2/`
- `.candidate-evidence/9700-as-cell-membranes-qwen-20261005-v1/`
- `.candidate-evidence/9700-as-cell-membranes-qwen-20261005-followup1/`
- `.candidate-evidence/9700-as-cell-membranes-replacement-primary-20261005-v4/`
- `.candidate-evidence/9700-as-cell-membranes-replacement-qwen-20261005-v1/`
- Promotion summary: `.candidate-evidence/9700-as-cell-membranes-promotion-20261005-v1/promotion-summary.json`

Candidate data root:

`data\ai-pdf-ingestion\chapter-ready-9700-as-cell-membranes-qwen-20261005-v1`

It contains six artifacts and nine pinned full-page cache entries. Evidence roots remain local and uncommitted; generated candidate data is ignored. Only the isolated source, bridge, integration, scripts, tests and this handoff are committed.

## Preserved baseline hashes

The original-foundation implementation and Chapters 1/2/3/8/9/10/11 source and bridge files were not edited. Their 42 existing study questions remain isolated from the six new Topic 4 questions.

| Existing file | SHA-256 |
| --- | --- |
| `server/originalFoundationPractice.js` | `e23006252c625b2491f12d7f212bd8cc1c0e7deaab0b7ca29903f3aa21f2458e` |
| `biology-9700-as-cell-structure-source.json` | `b914353013c9067ef080861f308d0a623a8a3ebe377f1e9749d9917f83d1c8ad` |
| `biology-9700-as-cell-structure-bridge.js` | `8275fbe208908b2bf7ee073117166b06a202434106448bafe193e24b0e0c161f` |
| `biology-9700-as-biological-molecules-source.json` | `6120e8c62b4d92652c9f1dab53ab593d06b1df65a484d34c99d571923a038751` |
| `biology-9700-as-biological-molecules-bridge.js` | `59a2864fbed23236517f844ce062634ae68719ad2b6bdf57969f2a5e43db37ec` |
| `biology-9700-as-enzymes-source.json` | `864e864f7b2540b5c0d3f02a3bd6989888686fa6b123b5117076eac8860c1c81` |
| `biology-9700-as-enzymes-bridge.js` | `67a0eb9f0ad3ccfdc8e36b1aaa9ebd76bf88fad2818804cf1050f8caca6085e8` |
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

- `npm run test:chapter-ready-cell-membranes`: exit 0. The source test reports six release-eligible study groups; the authenticated API test passes 6/6 private-answer scoring, no pre-submit answer leak, 401 rejection and formal-progress false.
- `node scripts/test-ai-verified-runtime-syllabus-mapping.mjs`: exit 0, with 10 Topic 4 points, 93 disjoint current 9700 point IDs and unchanged prior chapter counts.
- Chapter 1/2/3/8/9/10/11 focused suites: exit 0 using their isolated local data roots.
- `npm run lint`: exit 0 with six pre-existing warnings only.
- `npm test`: exit 0.
- Baseline preservation `git diff --quiet` for original foundation and Chapters 1/2/3/8/9/10/11 source/bridge files: exit 0.
- Release build remains a Root-controlled phase after independent source QA; this task did not add Topic 4 to a production manifest or deploy it.
