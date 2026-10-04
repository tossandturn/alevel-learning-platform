# 9700 AS Topic 10 chapter-ready candidate

Status: `PASS_CANDIDATE_NOT_DEPLOYED`

Baseline commit: `c361bfa6104af7310633ec4db3c5e5acbde98b52`

## Scope and readiness

- Route: `cie-9700-as-biology`
- Official topic: `9700-as-topic-10` (Infectious diseases)
- Official source: Cambridge 9700 2025-2027 syllabus, page 30, six outcomes in sections 10.1 and 10.2
- Candidate: 0 formally reviewed, 6 independently AI-checked study groups, `start-study`
- Formal progress remains disabled. The 12-group formal-ready threshold is unchanged.
- Five questions are from 2025 Paper 1 and one low-ambiguity reserve question is from 2024 Paper 1.
- This batch covers only the directly mapped outcomes present in the six selected questions. It does not claim complete outcome or historical-paper coverage.

## Independent verification

- Primary source review: `openai / codex-current-session`, one source-bound pass
- Independent verifier: `qwen / qwen3-vl-plus`
- Initial 2025 batch: 6 calls plus one clarification round of 3 calls
- Replacement 2025 batch: 3 calls plus one clarification round of 2 calls
- Reserve 2024 batch: 1 call, no clarification
- Every call used exactly one QP crop and one MS crop, one attempt, a 60 second limit and at most 2500 output tokens.
- Replacement and reserve batches used a strict `reviewDecision` enum (`accept` or `block`) separate from A-D answer fields. Raw provider results are retained before mapping to the standard receipt.
- Final clean set: 6 distinct whole Paper 1 MCQs with source identity, independent answer, exact MS answer, marks, direct official topic mapping and retained visual count all passing.
- No human, teacher or official-review claim is made.

Held questions remain excluded:

- `cie-9700-9700_s25_qp_12:q37`: Qwen returned an answer letter in the old decision field even though all substantive fields agreed.
- `cie-9700-9700_s25_qp_13:q37`: the initial result failed structurally and the clarification returned an answer letter in the old decision field.
- `cie-9700-9700_s25_qp_14:q37`: Qwen selected B while the official mark scheme gives A.
- `cie-9700-9700_s25_qp_11:q36`: direct syllabus mapping changed between reviews and did not converge.

Provider receipts:

- `.candidate-evidence/9700-as-infectious-diseases-qwen-20261004-v1/`
- `.candidate-evidence/9700-as-infectious-diseases-qwen-20261004-followup1/`
- `.candidate-evidence/9700-as-infectious-diseases-replacement-qwen-20261004-v1/`
- `.candidate-evidence/9700-as-infectious-diseases-replacement-qwen-20261004-followup1/`
- `.candidate-evidence/9700-as-infectious-diseases-reserve-qwen-20261004-v1/`
- Promotion summary: `.candidate-evidence/9700-as-infectious-diseases-promotion-20261004-v1/promotion-summary.json`

All paths above are relative to:

`D:\CodexWork\stem-chapter-ready-infectious-diseases-candidate-20261004`

## Data delta

Append this directory as a new batch. Do not replace or rewrite existing production artifact files:

`data\ai-pdf-ingestion\chapter-ready-9700-as-infectious-diseases-qwen-20261004-v1`

| Source question | Candidate SHA-256 |
| --- | --- |
| `cie-9700-9700_s25_qp_11:q38` | `1ef3694f2c0b30efabed6c2c3a747cedacd4d664d1b17c852c8e85992f45e86a` |
| `cie-9700-9700_s25_qp_13:q40` | `9fa3de9f02f99d4e6f9644ada50905c62fb9537d2e8331e311f957be97396685` |
| `cie-9700-9700_s25_qp_14:q38` | `ebf85829b0dd67c040030c0a17099f2c085e828cd708051523e5f8291c5b958b` |
| `cie-9700-9700_s25_qp_11:q37` | `5ee8837db439f199c04624f0e232271789e10b98c4293ec3f0c47b712d8e55cb` |
| `cie-9700-9700_s25_qp_12:q38` | `d8724af5566cdb87b51b7d278193f6b5ff67a4c57f8041cfc7e113ca2fb487cc` |
| `cie-9700-9700_s24_qp_12:q35` | `de59841b0e6966768ca72eb5e3e6ede9684001be0b9f0a37fe788ee60e3a95df` |

## Source pages and image cache

Canonical PDFs remain under `D:\CodexWork\cie-fraft-fetcher\output\pdf\9700` and the production shared PDF library. Required source pages are:

- `9700_s25_qp_11.pdf` pages 14 and 15; `9700_s25_ms_11.pdf` page 3
- `9700_s25_qp_12.pdf` page 18; `9700_s25_ms_12.pdf` page 3
- `9700_s25_qp_13.pdf` page 18; `9700_s25_ms_13.pdf` page 3
- `9700_s25_qp_14.pdf` page 16; `9700_s25_ms_14.pdf` page 3
- `9700_s24_qp_12.pdf` page 17; `9700_s24_ms_12.pdf` page 3

Pinned full-page cache files:

- `page-cache\34c2bd6ddcfd82130950b636ef64126d74ca566a91183e567d632dfeae6a9b01\18-a022b1f2015f4a919fd6273e8ec3b3de5dd71131a59486ad1fc828a69e8ac926.png`
- `page-cache\44726860b06063cf9e12c8a0b94c763ea4a6f46538a0dac0643a4694a7413078\17-efc9a6299ff07c5e40d56dc500ba7d31abada393325b4677224f93dd51c9859e.png`
- `page-cache\82281f4779bb1affaf128cbdc5c5a784905b3b6e9215aa15355a88f3eb0c472f\3-1a1f697cfad9b4364e1d9132e7af6d47a08494ab3eb790b2c0eedd9a93f852dd.png`
- `page-cache\98c1252136ef593b159a60fa6c5625ba0c8a05a16de535167f2e9c4cc18e0160\3-6285a384ab4d715a65e590d9b14c347de1d531a7350f8f3d708066ff885aa91a.png`
- `page-cache\9a0944413719077f1324b5249d1be493e2dd3fcf57993af5328112435cc9fcba\3-08ff72f2cf98f830a37e13c7400ded3dfc468bdffa9992de6c7bfbf5360454d1.png`
- `page-cache\9a0f49d4756f11960fa17b1acebd53c630f8285b5cf001afc6d540b6acbba7a3\3-f8aea74d3b9866c7ec4dfada226e3a6a08abe46382096ab2ba4457a11b68fe7a.png`
- `page-cache\b871301e28144f416cdfe4cb0ae874cd1bd73414eeae66cef67f25d0418dea51\14-c0216b9995691ed6efe8ada5770b10de00323e5532b2a61c32ed2d4a481108ba.png`
- `page-cache\b871301e28144f416cdfe4cb0ae874cd1bd73414eeae66cef67f25d0418dea51\15-df755dbc33ba8efb85e69fc076d73881c1dc0860d188921907386ec6042c4eab.png`
- `page-cache\d3213a7a142e859a632d48197446557f320f81c50bd5b881e9ead746284ad783\16-f623cedccc064f17daac768ae5ec30a98eea4cf6caa183cbb81907cd3ae02230.png`
- `page-cache\e6f95f47e51486f404ff5636d5dbfe9bd0e0dc3aebf4a13a0b8f358cfdd20461\18-edd67f19b60558b7818be9294354e44d0ce46b26b08a4d41c31abdc5b39f24ac.png`
- `page-cache\f1fa6fd2a88987f4fd32eb28ac0387210fed36b0aac18651fbf2ec294867f3fe\3-d89f00d4a5f2329d0ea273ebfb0382733caaad0aaa838ea503ad73ab48ebdc3e.png`

The `page-cache` paths above are relative to:

`.candidate-evidence\9700-as-infectious-diseases-promotion-20261004-v1`

## Activation constraints

- Add only the six candidate artifact files and the eleven required page-cache entries.
- Preserve every existing production artifact file byte-for-byte.
- Keep every held receipt and excluded question out of runtime data.
- Do not mark these questions formally reviewed or formal-progress eligible.
- Do not claim complete Chapter 10 outcome or historical-paper coverage.
- Run a fresh server readiness gate and Root acceptance before any upload, activation or restart.
- No student data, credentials, environment values or provider keys are part of this handoff.
