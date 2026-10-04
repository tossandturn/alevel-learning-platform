# 9700 AS Topic 2 candidate

Status: `PASS_CANDIDATE_NOT_DEPLOYED`

Baseline commit: `c0444e6556c5e9645ec39436bf47f820e9b2e7b8`

## Scope

- Route: `cie-9700-as-biology`
- Official topic: `9700-as-topic-02` (Biological molecules)
- Official source: Cambridge 9700 2025-2027 syllabus, printed pages 17-19
- Taxonomy: 23 outcomes across sections 2.1, 2.2, 2.3 and 2.4
- Candidate: 6 independently AI-checked whole 2025 Paper 1 MCQs, study-only and `formalProgressEligible: false`

Chapter Study can start from these questions and the authenticated API scores all six private answers. The six true-source groups satisfy the selected student-study release floor without counting original-foundation content; formal readiness remains disabled at 0/12 reviewed groups.

## Final questions

| Source question | MS key | Direct official points | Candidate SHA-256 |
| --- | --- | --- | --- |
| `cie-9700-9700_s25_qp_11:q8` | A | `2.2.1`, `2.2.8` | `3e66c76a1ccca6c11a2219c99ac99fecd2b9d3c20765355c6252c8d414fb2a06` |
| `cie-9700-9700_s25_qp_11:q9` | A | `2.2.2` | `22cb10fb8a05245c9d8210d20cebf87a3230004cf3f9d7f5abf5edbb5da35af4` |
| `cie-9700-9700_s25_qp_12:q10` | A | `2.4.1` | `28594244ee10eb5b6538ebd91f11094c8552007c41bada0a526ac84556dfc5b1` |
| `cie-9700-9700_s25_qp_13:q9` | C | `2.2.6` | `3ac4050263c2a253f998b879e4198fd188a325a071e7b64d4682d0313547bd59` |
| `cie-9700-9700_s25_qp_13:q14` | B | `2.4.1` | `04bf1b70a29f94b50e338f3e2fb208512dbbc8ebff9aa6ebddca8160689ebec0` |
| `cie-9700-9700_s25_qp_14:q13` | A | `2.4.1` | `9570d3d9af430934798566fba7c0ea00e5f14af02d2bf26645ca34126bc25455` |

## Geometry

- Final `s25/11 Q8` answer table: normalized `[0.10, 0.095, 0.56, 0.275]`, source pixels `148,199,834,579` on the pinned 1488x2105 PNG. Header, all A-D rows and borders are complete.
- Final `s25/14 Q13` answer table: normalized `[0.10, 0.68, 0.55, 0.84]`, source pixels `148,1431,819,1769`. Header, all A-D rows and borders are complete.
- The other four final questions contain no non-text visual object. Their complete QP crops and exact MS rows were directly inspected.
- The excluded Q7 and Q12 table regions remain only in failed evidence roots and are not runtime artifacts.

## Provider budget

- Primary source review: `openai / codex-current-session`, source-bound
- Independent verifier: `qwen / qwen3-vl-plus`
- Initial blind batch: exactly 6 calls
- Clarification batch: exactly 3 calls, the maximum allowed
- Fixed replacement batch: exactly 3 questions, one call each and no clarification
- Authorised replacement stage 2: first new question passed in one call; work stopped immediately with two calls, including the optional clarification, unused
- Every call used one complete QP crop and one exact MS crop, one attempt, a 60 second timeout and at most 2500 output tokens.
- No unapproved call, retry, receipt rebinding or comparison relaxation was used. The original 12-call ledger and the separately authorised one-call stage-2 ledger remain distinct.

Held questions remain excluded:

- `cie-9700-9700_s25_qp_11:q7`: independent mapping expanded to additional test/hydrolysis outcomes.
- `cie-9700-9700_s25_qp_11:q10`: independent mapping retained the triglyceride-structure outcome after clarification.
- `cie-9700-9700_s25_qp_14:q11`: independent mapping expanded beyond the pinned globular-protein outcome.
- `cie-9700-9700_s25_qp_13:q12`: the third replacement disagreed and had no remaining clarification budget.

Evidence roots:

- `.candidate-evidence/9700-as-biological-molecules-primary-20261005-v1/`
- `.candidate-evidence/9700-as-biological-molecules-qwen-20261005-v1/`
- `.candidate-evidence/9700-as-biological-molecules-qwen-20261005-followup1/`
- `.candidate-evidence/9700-as-biological-molecules-replacement-primary-20261005-v1/`
- `.candidate-evidence/9700-as-biological-molecules-replacement-qwen-20261005-v1/`
- `.candidate-evidence/9700-as-biological-molecules-replacement-stage2-primary-20261005-v1/`
- `.candidate-evidence/9700-as-biological-molecules-replacement-stage2-qwen-20261005-v1/`
- Promotion summary: `.candidate-evidence/9700-as-biological-molecules-promotion-20261005-v3/promotion-summary.json`

Candidate data root:

`data\ai-pdf-ingestion\chapter-ready-9700-as-biological-molecules-qwen-20261005-v3`

It contains six artifacts and nine pinned full-page cache entries. Five artifact files are byte-identical to blocked v2; only the new `s25/14 Q13` artifact and receipt were added.

## Preserved baseline hashes

The existing original-foundation and Chapters 1/8/9/10/11 source and bridge files were not edited.

| Existing file | SHA-256 |
| --- | --- |
| `server/originalFoundationPractice.js` | `e23006252c625b2491f12d7f212bd8cc1c0e7deaab0b7ca29903f3aa21f2458e` |
| `biology-9700-as-cell-structure-source.json` | `b914353013c9067ef080861f308d0a623a8a3ebe377f1e9749d9917f83d1c8ad` |
| `biology-9700-as-cell-structure-bridge.js` | `8275fbe208908b2bf7ee073117166b06a202434106448bafe193e24b0e0c161f` |
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

- `npm run test:chapter-ready-biological-molecules`: exit 0. The source test reports six release-eligible study groups; the authenticated API test passes 6/6 private-answer scoring, no pre-submit answer leak, 401 rejection and formal-progress false.
- `node scripts/test-ai-verified-runtime-syllabus-mapping.mjs`: exit 0, with 23 Topic 2 points and unchanged Chapters 1/8/9/10/11 counts.
- Chapter 1/8/9/10/11 focused suites: exit 0 using their isolated external data roots.
- `npm run lint`: exit 0 with pre-existing warnings only.
- `npm test`: exit 0.
- Baseline preservation `git diff --quiet` for original foundation and Chapters 1/8/9/10/11 source/bridge files: exit 0.
- Release build remains a Root-controlled phase after independent source QA; this task did not add Topic 2 to a production manifest or deploy it.
