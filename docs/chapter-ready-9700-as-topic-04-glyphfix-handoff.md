# 9700 AS Topic 4 Q12/20 glyph-correction handoff

Status: `PASS_CANDIDATE_NOT_DEPLOYED`

Baseline commit: `00033cb8aba9521685e3485188e37f1d3ed9d14a`

## Outcome

- Route/topic: `cie-9700-as-biology` / `9700-as-topic-04`
- Corrected source question: `cie-9700-9700_s25_qp_12:q20`
- The unchanged official PDF `9700_s25_qp_12.pdf` remains SHA-256 `e6f95f47e51486f404ff5636d5dbfe9bd0e0dc3aebf4a13a0b8f358cfdd20461`.
- Page 10 is now rendered through Poppler at 180 dpi. The corrected full-page PNG is `1488x2105`, SHA-256 `aa56d92bafd98b136fde78ed7c5e0fbae4e249e1713570c9df2dd3660672348e`.
- The bound diagram region remains normalized `[0.10, 0.105, 0.90, 0.31]`, source pixels `[148, 221, 1340, 653]`, and contains all three cubes and all three labels with legible multiplication signs.
- Independent derivation is `SA = 6 × 2² = 24`, `V = 2³ = 8`, so `SA:V = 24:8 = 3.0:1`; answer `D`. Direct points remain `4.2.3` and `4.2.4`.

## Root cause and repair boundary

The original Q12/20 binding used the Paddle/PyMuPDF page cache SHA-256 `fa5ae4d1559d7d2bb46e7ecfd4c366c2fe6cca1a99d16dded3cd7f1a16b18526`, whose multiplication glyphs rendered as squares. The repair adds an explicit `poppler-png` source-page renderer and opts in only Q12/20. No PDF, question text, answer, diagram, syllabus mapping, or other source artifact was redrawn or edited.

## Promotion-v2 evidence

- Data root: `data/ai-pdf-ingestion/chapter-ready-9700-as-cell-membranes-qwen-20261005-v2`
- Promotion summary: `.candidate-evidence/9700-as-cell-membranes-promotion-20261005-v2/promotion-summary.json`
  - SHA-256: `a3e5c68a8d2b26b6fe7fa4d4e21f0e3f212e843a61f5bb897a28319d42e410c8`
- Local root-acceptance evidence: `.candidate-evidence/9700-as-cell-membranes-promotion-20261005-v2/root-acceptance.json`
  - SHA-256: `0f5e49660f50cd3cfdab8960843292f9be671ac1ae386dd99a66d72529ac07fd`
- Independent Root acceptance: `D:/CodexWork/stemist-release-coordination/chapter-data-ready-20261005/cell-membranes-root-acceptance.json`
  - Status: `PASS_ROOT_SOURCE_ACCEPTANCE_NOT_PUBLISHED`
  - SHA-256: `8f9ca7d557f0fd2f00ec30f2332b1e7a5188693fd41263cb89e3e69dd1c1cdd2`
- Fresh primary summary SHA-256: `237e3bd0283f17d8ee1974babc0020bba2cd5771a45530ffa18b4814ee382077`
- Fresh primary Q12/20 artifact SHA-256: `839d29b8f3ea2645f155503f04e527a8273485eea9923d886519dca706a430bb`
- Fresh Qwen PASS receipt SHA-256: `4ff97ea865073cb51706d351fe9e867af6cded1272c5146bd8f23528818218b6`
- Promoted Q12/20 artifact SHA-256: `64d23f1b83192a0d508ca8fe16cade02bb5e02063d3352621f68284f22f95472`

The original v1 promotion summary remains `PASS_CANDIDATE_NOT_DEPLOYED`, SHA-256 `67b04b6e007dba56b2849a85d09398214b73d1e375ec6739f915139d1f9b67a6`. Promotion-v2 carries five fallback receipt paths and their unchanged hashes.

## Byte-identical preserved artifacts

| Source question | v1/v2 artifact SHA-256 | Fallback receipt SHA-256 |
| --- | --- | --- |
| `cie-9700-9700_s25_qp_11:q17` | `86ba3e257d2c139969ab62831ecdacff781a4cc34c9dd759285b50c3c8613769` | `33c56dbc34d601773538a4c59e8eed3a9abf00fa1fd2b4b692235b2bd60f6731` |
| `cie-9700-9700_s25_qp_11:q18` | `77a1505bdcd55ea51e86fd97e607ad30d2c0d18ab43031cb864e95c2dd46ad27` | `67b6f68b05abbaea05c0b8a4b36287a1d7fad4f2a4d4cb17e169ecae5e9e406e` |
| `cie-9700-9700_s25_qp_12:q19` | `6c45434cb2df56f96ccb3fa81c4395b347ceb97da0484769cc868f080e60587a` | `1d1d3e361e1394a593c9fa303d5df93eb8f31e43921dfa3d29c90b876ba83583` |
| `cie-9700-9700_s25_qp_14:q17` | `107027601f840abc1c50a64a54d7c9fec898e2a95e60d5285b1fba065b7a43eb` | `ae8da3a56856caa4f0d1706613bba20b62a2d3a235570cc30d09aea43a65e175` |
| `cie-9700-9700_s25_qp_14:q18` | `96a9c53c2046befaea6288ca6668dee4ac69793f28c4677e6a8d864c2474f676` | `bf6bac5b5ecb35e6933f455c1a122cc09b339900066fd924ba4b557e8a52b0ee` |

## Independent-review budget

- Provider/model: `qwen / qwen3-vl-plus`
- Maximum new calls: 2
- Initial calls: 1
- Clarification calls: 1
- Total: 2/2, one attempt per call, 60 seconds, two images, at most 2500 output tokens
- Initial review independently derived `D` but used a syllabus point ID in `primaryTopicId`, so it remained held.
- The one allowed clarification preserved the proof and corrected the route-topic field. It passed; no further call was made.
- Raw receipts were not edited.

## Validation

- `npm run test:chapter-ready-cell-membranes-glyphfix`: pass; exact Poppler page hash/dimensions, five byte-identical artifacts, corrected binding, six unique groups, 6/6 private-answer scoring, no pre-submit answer leak, unauthenticated rejection, and `formalProgressEligible: false`.
- Existing Topic 4 source and authenticated API tests against the v2 root: pass.
- Chapters 1/2/3/8/9/10/11 focused source/API suites: pass.
- Original foundation v1/v2 and Chapter Study suites: pass (`222` v1 and `666` v2 items).
- `node scripts/test-ai-verified-runtime-syllabus-mapping.mjs`: pass.
- `node scripts/test-ai-source-images.mjs`: pass.
- `npm run lint`: exit 0 with six pre-existing warnings only.
- `npm test`: exit 0.
- Old evidence/data immutability comparison: 106 files across ten evidence roots plus the v1 bank matched the untouched source candidate byte-for-byte.

## Safety boundary

- No Git push, SSH, deployment, production mutation, client upload, OCR worker, environment-value disclosure, or student/database access occurred.
- The original cell-membranes candidate, original PDF, old six-artifact bank, old summaries, old receipts, prior chapters, original foundations, and priority audit JSON were not modified.
- Promotion-v2 remains local and not published; Root controls any later cherry-pick and release work.
