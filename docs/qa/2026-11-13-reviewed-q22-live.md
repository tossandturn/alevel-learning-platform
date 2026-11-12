# Reviewed Q22 — isolated live vision marking

Date: 2026-11-13, Asia/Shanghai. Outcome: **PASS for the narrow source-bound, single-question vision-marking case below.** This is not whole-paper, real-handwriting or native-client acceptance.

## Evidence

- Actual execution report: task artifact `qa/reviewed-q22-live-20261113.json`; SHA-256 `a85a1a197acf09f4a00bd9b9d022b259a1b94ac7d3c654959142b4fa1ce42139`.
- Original isolated helper report SHA-256: `c04d202489be97bc8151cb210af18e549d6574fb901e7d43486ce8e1d230c1d5`.
- Frozen seven-file input manifest SHA-256: `f70d6bdefa06e552135bf5666b83f9c18bda7bd91d91018525976bbe61eedfa9`.
- Independent canary review SHA-256: `29347628d79e46869a6521b1ddaffe805c6b806b50e6d3e0b110877aed042bd0`.
- Executed controller SHA-256: `7fad3013ba89d6185d85bddbee043a7230ecc49b732cd411944ec00ae147f9da`.
- Readiness gate bound to execution SHA-256: `1ec4bfa292bc3d1724426d76b1671d8adee4b9af82617bab5967ceecabdb3dac`.
- Full resource/service post-gate: task artifact `ops/stem-voice-84322852dfac-20261113.gate-post-20261112T200055397Z-8bde5ee9.json`; SHA-256 `6739c01bbb7e095c22a69147ddd9c0db8e7e69613533c3d24154e391de9a43e3`. Its recorded check time is `2026-11-12T20:01:09.288Z` (2026-11-13 04:01:09.288 Asia/Shanghai).

The root operator performed the single live execution and the resource gates. This document was prepared by reading and hashing the saved evidence; no extra paid request was made for documentation.

## Genuine source, explicitly synthetic answer

The existing reviewed canonical record is `cie-0580-0580_m25_qp_12:q22`, part `cie-0580-0580_m25_qp_12:q22:part-a`, with binding/review signature `fnv1a64:3140cea91d0a5322` and schema `stem-source-review.v1`.

The question asks for `1 7/15 - 4/5` in simplest form. The official mark scheme gives 3 marks for `2/3`; an unsimplified equivalent such as `10/15` has a separate lower-credit branch. The implementing and root agents visually checked original QP page 15 and official MS page 9 before execution. Historical review metadata names `Codex /root/verify_q18_q26`; this is **not claimed to be human review**.

| Immutable input | SHA-256 |
| --- | --- |
| Original QP PDF | `bb8bebf6fabb2cb1a4dd0ff5387bdb6407ba2934046974312d9aed88b3cdfc26` |
| Original MS PDF | `5d98f30296127753df1b0d7b10f244d29103c199fd198574c007d750308714a5` |
| Existing QP page-15 JPEG | `973cd49ddfdff7aff42740d640d5d06fda846eb5dbba50a23a0eb3755fd1a189` |
| Existing MS page-9 JPEG | `ea8eb3ec757ee5f005fbd7d98d7b4430d44ffc8c3742bd576dba0bd0a801fa31` |
| Synthetic answer PNG | `f818deb0c4948112bd2282dda1ccb577ea269923e517fb1a38bfe2e13aa6532b` |
| Canonical input/source proof | `6b8ae127d097e1bb66b840d30dff7b725e0f7fe0a90bf949a7fd8384fd13c340` |

The generated answer image visibly says `SYNTHETIC QA ANSWER - NOT A STUDENT PHOTOGRAPH`. Its printed working is `22/15 - 12/15`, then `10/15`, then `2/3`. It is not a photograph, handwritten script, or student record. The test verified the exact three image hashes and order sent to the configured vision provider: official QP, official MS, synthetic response.

## Actual result

| Check | Observed result |
| --- | --- |
| Deliberately wrong source binding | HTTP 422; rejected before any provider call |
| Positive request | HTTP 200; `mode=vision`, `providerStatus=connected` |
| Real provider requests | Exactly 1; no automatic retry or fallback |
| Score | Raw and returned score **3 / 3** |
| Returned review fields | `confidence=1`, `reviewRequired=false` |
| Structured evidence | Three returned records, 1 mark each, with nonempty reason and student-evidence hashes; sum reconciles to 3 |
| Provider telemetry | HTTP 200, valid schema, connected, `fallback=false` |
| Handler duration | **14.124 seconds** |
| Provider duration | **14.024 seconds** |
| Complete isolated child duration | **15.331 seconds**; exit 0, no timeout |

These timings describe one server-side synthetic case, not phone upload latency, a percentile benchmark, or a universal completion-time promise. The model's returned confidence of 1 is not an independently measured 100% accuracy rate. Full credit for this answer is verified; the model's individual partial-credit allocations have not been validated by this case.

## Isolation and production postcheck

- The child used a 384 MiB V8 old-space budget and `/usr/bin/prlimit --core=0:0`; disabled core dumps were observed. The controller's 110-second child deadline did not fire.
- A persistent one-shot guard prevented an automatic rerun. All canary writes were confined to its newly created private staging/scratch directory. Reports contain bounded diagnostics and hashes, not raw provider responses, secrets or exception messages.
- Database construction attempts: **0**. No real student account, database, native submission, order or learning record was read or changed. Production runtime writes: **0**.
- Production source hashes were unchanged before/after, including `server/aiApi.js` (`16fda51d18b553bc8da0ddc9d581c920f412a5735516db748cf40dc494098595`), `src/lib/sourceContentContract.js` (`bd1db036b8c4decf54118477a6015e0ae21a9077307934b682ab41a90f7b762b`) and `src/data/questionBank.js` (`e996b6068af6c278656393a2fbc400e5f80134295def57e349a21c5b106ad46d`).
- Production process pins were unchanged: STEM PID **1713487**, restarts **121**; IELTS PID **1688728**, restarts **40**. No production restart was performed for this test.
- The complete post-gate was **PASS**, with 2,533,928,960 bytes of memory available (about 2.53 GB), disk use 72%, no gate failures, and all four local/public STEM/IELTS health checks returning 200.

## Explicitly not verified

1. Real student handwriting, photographed work, rotation, poor lighting, ambiguous symbols, tablet/Pencil input, and weak-network image upload.
2. The native-client submit journey, real identity/attempt persistence, score backfill, history refresh, or automatic database finalization. The consolidated helper report contains `autoFinal=false`, but the helper projects this as `v.autoFinal === true`; a missing upstream field also becomes false. **That projected value cannot establish whether native automatic storage is enabled or disabled.** This canary intentionally used no real database and did not execute a native submission.
3. Whole-paper marking, multi-question aggregation, all subjects/exam boards, partial-credit/error cases, omitted answers, or rubric correctness beyond this full-credit Q22 example.
4. Repeated-run reliability, latency percentiles, or a global claim that every AI feature is fixed.

The supported conclusion is limited and concrete: the deployed source-bound marking handler can read this verified official QP/MS pair with a synthetic answer image, reject a mismatched binding without a model call, and return the expected structured full-credit score through one real configured-provider request.
