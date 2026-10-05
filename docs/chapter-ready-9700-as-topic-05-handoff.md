# 9700 AS Topic 5 candidate v3

Status: `PASS_CANDIDATE_NOT_DEPLOYED`

Baseline commit: `207538d442bdb68fa2f80c162d42defd10136a0f`

Candidate: `D:\CodexWork\stem-chapter-ready-mitotic-cell-cycle-candidate-20261005`

## Scope and official syllabus

- Route: `cie-9700-as-biology`
- Topic: `9700-as-topic-05` (The mitotic cell cycle)
- Authoritative source: [Cambridge 9700 Biology 2025-2027 syllabus](https://www.cambridgeinternational.org/Images/664560-2025-2027-syllabus.pdf), printed page 23
- Current taxonomy: `5.1.1`-`5.1.6` and `5.2.1`-`5.2.2`, eight outcomes total
- Candidate: six whole 2025 Paper 1 MCQs with source-bound local review plus independent `qwen3-vl-plus` review
- Eligibility: every item is `aicheck` and `studentStudyEligible: true`; all remain `formalProgressEligible: false`

The six official groups satisfy the unchanged six-question study-ready floor. Formal readiness remains 12 reviewed distinct groups. Original-foundation questions stay explicitly labelled and are not counted among these six official groups.

## Final six

| Source question | QP / page | MS / page | Key | Direct outcome(s) | Artifact SHA-256 | Accepted receipt SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `cie-9700-9700_s25_qp_11:q19` | `9700_s25_qp_11.pdf` / 8 | `9700_s25_ms_11.pdf` / 2 | A | `5.2.1` | `1e40de4d97c64e6048c98bfaeab3c2a81aab6bae7c95b7d7c2ec91b14c1e2cd7` | `5457eb2a9c8f959ecfe2fd613bb40e814aa52eb2407297e44b5b67ed082bce88` |
| `cie-9700-9700_s25_qp_11:q20` | `9700_s25_qp_11.pdf` / 9 | `9700_s25_ms_11.pdf` / 2 | B | `5.1.1` | `ec2349fa2d47eb2730326437af6dbb98375297f8795f2e2516a8355a3fbc87ef` | `a83a9d12bea18c1aac6c6ce62ae35a6535544080e1113c596f3da165f46a4afb` |
| `cie-9700-9700_s25_qp_12:q22` | `9700_s25_qp_12.pdf` / 11 | `9700_s25_ms_12.pdf` / 2 | D | `5.1.3` | `e46ddc76fcf0c34ad0648cba611c927afb828141d1f7289bb0e8130d880a1b4b` | `233383fa244cfe908b144e28093125a2284ef1d7ce5976237e38b76639b16ecd` |
| `cie-9700-9700_s25_qp_14:q21` | `9700_s25_qp_14.pdf` / 11 | `9700_s25_ms_14.pdf` / 2 | C | `5.1.2` | `6019d51d6cdd063e93b9674099015a407a3092102a239f254193014374372859` | `db9217d2ccd37cdcdd04df5068e28a936fc9ad733836d2890a89c97afb968a88` |
| `cie-9700-9700_s25_qp_14:q22` | `9700_s25_qp_14.pdf` / 11 | `9700_s25_ms_14.pdf` / 2 | D | `5.1.4` | `0d8d9b6762553f1df007c5c390383e758b5297568bde73514b68e56cac1bc358` | `38d24e5786156c34e2d794d56bacf541938c2dd642ffff155959c277d3509064` |
| `cie-9700-9700_s25_qp_13:q21` | `9700_s25_qp_13.pdf` / 10 | `9700_s25_ms_13.pdf` / 2 | A | `5.2.1` | `fe418041535f69188307e56191a30306fc5e298be54334351d5c3d40d7e9c7f3` | `e6094d213580e044c2d61d0260bf3c48dee875c512e0c6b24b276a09cddc87f8` |

Five artifact bytes are identical to promotion v2: corrected Q11/20, Q12/22, Q14/21, Q14/22 and modality-clean Q13/21. Q11/19 is the one new v3 artifact. The three legacy unchanged items Q12/22, Q14/21 and Q14/22 remain byte-identical throughout.

## Source identity and geometry

| Paper | QP PDF SHA-256 | MS PDF SHA-256 | QP producer PNG | MS page 2 producer PNG |
| --- | --- | --- | --- | --- |
| `s25/11` | `b871301e28144f416cdfe4cb0ae874cd1bd73414eeae66cef67f25d0418dea51` | `9a0f49d4756f11960fa17b1acebd53c630f8285b5cf001afc6d540b6acbba7a3` | p8 `e1a5a09d8301789b3fdd3c1074eaa4b337aeef3821c5b9d0e5c0ebeecdb22771`; p9 `b2f4809dc1f9d250a9abbf9f6a440825d417f002ab388772b50363fa4f7be921` | `36e5fb50b9fd3d45135b370a253f23c82f5b663c6f9ce2506cf04273107b67ef` |
| `s25/12` | `e6f95f47e51486f404ff5636d5dbfe9bd0e0dc3aebf4a13a0b8f358cfdd20461` | `f1fa6fd2a88987f4fd32eb28ac0387210fed36b0aac18651fbf2ec294867f3fe` | p11 `83af6f1cbcff0b5268324a08b8772d9c207c7211b559361fef8ac9dec0abd7eb` | `488acb727f1dcc685aef91889b349363f8742e8e16e4fba3dd17d41eb0d4003b` |
| `s25/13` | `34c2bd6ddcfd82130950b636ef64126d74ca566a91183e567d632dfeae6a9b01` | `9a0944413719077f1324b5249d1be493e2dd3fcf57993af5328112435cc9fcba` | p10 `1025d8c2b54cdcdf07c20ee936e64d29a076672cba3c5f7b2a8084c641b26365` | `27ec89c673064da996a1247874b082d184ececba45828fe128e905b9ce2f468d` |
| `s25/14` | `d3213a7a142e859a632d48197446557f320f81c50bd5b881e9ead746284ad783` | `98c1252136ef593b159a60fa6c5625ba0c8a05a16de535167f2e9c4cc18e0160` | p11 `c2b487f6f68602dc9449aeb7103df7b2da05c2937fdf707e26448d660e9812bf` | `3bfe595cf1c63c303b0c73e0acd6ac00b2d830aa4647991797c188ad5254e8e1` |

Normalized QP regions and exact MS rows:

| Source question | Whole QP `[x0,y0,x1,y1]` | Distinct visual regions | MS row `[x0,y0,x1,y1]` |
| --- | --- | --- | --- |
| `s25/11 Q19` | p8 `[0.06,0.38,0.94,0.91]` | results table `[0.29,0.455,0.71,0.605]` = pixels `[431,957,1057,1274]`; option table `[0.11,0.645,0.54,0.825]` = `[163,1357,804,1737]` | p2 `[0.075,0.6285780122,0.92,0.6547467693]` |
| `s25/11 Q20` | p9 `[0.06,0.06,0.94,0.385]` | figure `[0.33,0.09,0.68,0.20]` = pixels `[491,189,1012,421]`; option table `[0.11,0.23,0.49,0.37]` = `[163,484,730,779]` | p2 `[0.075,0.6577185481,0.92,0.6837590270]` |
| `s25/12 Q22` | p11 `[0.06,0.585,0.94,0.655]` | none | p2 `[0.075,0.7157003041,0.92,0.7418690612]` |
| `s25/14 Q21` | p11 `[0.06,0.58,0.94,0.765]` | none | p2 `[0.075,0.6865722396,0.92,0.7127730663]` |
| `s25/14 Q22` | p11 `[0.06,0.765,0.94,0.925]` | none | p2 `[0.075,0.7157003041,0.92,0.7418690612]` |
| `s25/13 Q21` | p10 `[0.06,0.46,0.94,0.68]` | none | p2 `[0.075,0.6865722396,0.92,0.7127730663]` |

All PDFs came from `D:\CodexWork\cie-fraft-fetcher\output\pdf\9700`. All source PNGs came from already completed OCR jobs. No OCR worker was started.

## Modality correction

Official outcome `5.2.2` requires interpretation of a photomicrograph, diagram or microscope slide. Q13/21 is text-only. Q11/19 contains two tables, but no cell diagram, photomicrograph or microscope slide. Before each final provider request, deterministic eligibility:

- retained all other seven current Topic 5 outcomes in the allowed response enum;
- excluded only `5.2.2` with reason `official-outcome-requires-photomicrograph-diagram-or-microscope-slide`;
- supplied `hasDiagram=false`, `hasPhotomicrograph=false` and `hasMicroscopeSlide=false`; `printedTableCount` was 0 for Q13/21 and 2 for Q11/19;
- did not include an expected answer or key and did not rewrite provider output.

The schema emits source checks and concise reasoning before terminal answer fields; `reviewDecision` is last. Q13/21 input/schema SHA-256 is `d3062f885a2e941e2617a05a804d3a5d4bf474626fae58a4194ece91d45f3cc0`. Its provider independently concluded prophase A, matched MS A, returned visual count 0, selected only `5.2.1`, and accepted without disagreement. Q11/19 input/schema SHA-256 is `0b5799e5ed70941874ec466e2e50f5aeb61ece5bcb17f73c7600a575854a0b5d`. Its provider first computed 225 and 120, chose A, then confirmed MS A, returned visual count 2, selected only `5.2.1`, and accepted without disagreement.

## Audit history and provider budgets

Old promotion v1 remains byte-unchanged at SHA-256 `456415224e8cb5b370b50fdc49652d953b2e20daf918c33904e4a51c94871b39`. Superseded promotion v2 remains byte-unchanged at SHA-256 `35643ae3a50383ca294baf5ff701c316dae41bd7c571a5b54d8fc58dcca612ea`. Promotion v3's root-audit sidecar preserves exact paths and hashes for every rejected or held receipt, including:

- old Q11/20 receipt with a one-visual undercount;
- old Q11/21 receipt whose rationale rejected transcription until deferring to the MS, plus the sealed QP-only proof that independently chose B after inventing a specificity qualifier;
- Q12/21 receipt whose prose independently argued C while structured fields accepted D;
- Q12/23 provider-failure and structured-block receipts;
- Q11/19 provider-failure and structured answer/decision conflict receipts;
- the pre-modality Q13/21 mapping-disagreement receipt.

Budgets were separately authorised and are all exhausted:

- initial stage: 12/12 calls;
- repair stage: 3/3 calls;
- modality-correction stage: 1/1 call;
- Q11/21 corrective stage: one QP-only call plus one redirected Q11/19 full-source call, 2/2;
- combined: 18 calls; no further calls authorised.

Every call used two images, one attempt, a 60-second timeout and at most 2500 output tokens. No receipt was edited or rebound.

## Canonical paths

- Artifact root: `D:\CodexWork\stem-chapter-ready-mitotic-cell-cycle-candidate-20261005\data\ai-pdf-ingestion\chapter-ready-9700-as-mitotic-cell-cycle-qwen-20261005-v3`
- Promotion summary: `D:\CodexWork\stem-chapter-ready-mitotic-cell-cycle-candidate-20261005\.candidate-evidence\9700-as-mitotic-cell-cycle-promotion-20261005-v3\promotion-summary.json`
  - SHA-256: `75ee7a9aeaa04240b6b96b11f3b38f8aad2c97f4d9b5122a177b6a5ac7e37a6d`
- Root-audit sidecar: `D:\CodexWork\stem-chapter-ready-mitotic-cell-cycle-candidate-20261005\.candidate-evidence\9700-as-mitotic-cell-cycle-promotion-20261005-v3\root-audit-sidecar.json`
  - SHA-256: `e2e9bac0e7a2a6b48b587d279419e0d0ad4758c8beefa7b4dd2ca031a3cfe515`

Evidence roots and canonical artifacts remain local and uncommitted, matching the existing chapter-candidate workflow. Source catalog, bridge, route integration, preparation/review/promotion scripts, tests and this handoff are committed.

## Preserved baseline

`server/originalFoundationPractice.js` and every Chapter 1/2/3/8/9/10/11 source/bridge file remain byte-identical to baseline. The existing 36 official study questions remain isolated from Topic 5. The three legacy Topic 5 items reused in v3 are byte-identical to promotion v1, and five v3 artifacts are byte-identical to promotion v2.

## Verification

- `npm run test:chapter-ready-mitotic-cell-cycle`: exit 0. Terminal-field order, modality eligibility, QP-only `sourceRunner`, six source/hash/geometry groups, six correct and six wrong API choices, six source-image responses, no pre-submit answer leak, 401 rejection, owner isolation and no cross-chapter borrowing all passed.
- `node scripts/test-ai-verified-runtime-syllabus-mapping.mjs`: exit 0. Topic 5 has eight current points; all current 9700 point IDs remain disjoint.
- `npm run test:chapter-independent-start`: exit 0. All 222 chapters remain independently startable and the 6/12 gate is unchanged.
- `npm run lint`: exit 0 with six pre-existing warnings only.
- `npm test`: exit 0. The complete pretest and test chain passed; global readiness remained `readyRouteCount=0`, `blockerCount=223`.
- Baseline byte-diff: exit 0. Promotion v1/v2/v3 and sidecar hashes matched their immutable expected values. Scoped secret scan found no matches. `git diff --check`: exit 0.

## Safety boundary

- No push, deployment, SSH, production build, restart, swap action, OCR worker, actual database access, secret access or Mini Program upload occurred.
- No `.env` value, credential, token, cookie, private key or database content was read or persisted.
- No production or Root-maintained checkout file was edited.
- Root owns the final independent source/code audit, integration and any later package or release decision.
