# Answer-first Coach and optional paper lookup

The user changed the product flow: answer the question first, then ask whether to identify its past-paper year. The source-recall implementation remains available but no longer runs automatically while answering.

## Backend

- Ordinary academic HTTP/SSE requests no longer access the source index or ask the model for a provenance transcription. A successful complete answer includes only `sourceLookupAvailable`; it does not append a source section. Unexpected model source claims/private lookup trailers are still hidden. Partial, failed, Tavern and active-exam behavior remains isolated.
- `POST /api/ai/coach/source` requires authentication and `confirmed: true`. It reuses canonical attempt authorization and blocks active/unverified-bound exams. IELTS and Tavern are out of scope. Text queries use existing local source retrieval. Image queries make one bounded JSON transcription-only request, with thinking disabled for transcription, then retrieve verified origins. The endpoint never regenerates the teaching answer.
- Source lookup does not persist student photos, text, conversations or account data. Provider errors and malformed OCR return a safe retryable error. The existing original-paper index and matching safeguards are unchanged.
- Main answer model, reasoning policy, credentials and deadlines are unchanged. Speed work removes optional work from the answer path; it is not a lower-accuracy model switch or a larger timeout.

## Native client

The existing Coach panel shows an inline “是否识别这是哪一年的真题？” only after completion, with “识别出处” and “暂不识别”. No modal interrupts reading. Confirm dispatches exactly one request; decline performs no lookup. A separate source result/error does not overwrite the answer.

The private original-input snapshot is kept out of `setData`, drafts and storage. Reset, question/image/context changes, identity/privacy changes and teardown invalidate pending results. Duplicate taps are blocked and cancellation releases the image snapshot. Source presentation uses existing accessible native controls and visual tokens.

Readable streaming text and completed formulas can display before a paragraph-ending newline; unfinished math remains hidden and incomplete responses never count as submitted answers. IELTS's response handling is unchanged.

## Verification

PASS: backend Coach/source/auth/exam/provider/Tavern suites; zero source-bank reads during answering; source confirmation, text/image lookups, malformed OCR and failure isolation. PASS: full native `test:all`, including download/resume regressions, plus both actual Coach page-state flows. PASS: isolated native simulator component/handler checks for offer, confirmation, decline and retained answers. The simulator uses synthetic state and blocked external APIs, not a real student account.

Main-package check: 1,961,704 bytes, leaving 135,448 bytes under the 2 MiB limit and retaining the 128 KiB safety floor. Existing pinned esbuild identifier-only transforms were extended to the source-action helper and PDF download/cache utilities; source download logic is unchanged. Both source and transformed behavior are verified before upload. Original user-owned IDE configuration is preserved.

Reference: [Vercel AI's explicit approval boundary](https://github.com/vercel/ai/blob/20c4031d1fc59aab54b67c16679e3981374690ab/packages/code-mode/src/tool-invocation.ts). No dependency or implementation copied.

## Deployed acceptance

Backend runtime `dc8f22d377f24cf0e06bf584da5ad7af2238c8f7` is DEPLOYED as a two-file code overlay. The source index, other services, environments, model settings and student databases were not changed. Pre/post resource, exact-target, protected-file and rollback-hash checks passed. Swap was 9.86%; available memory after final acceptance was 2,333 MiB; disk free 7.67 GiB. Sibling service process identities/restart counts were unchanged.

Three fresh real-provider image requests through the deployed middleware completed with **zero source-bank reads during answering**, no source footer and intact SSE results. Each was followed by a separate explicitly confirmed lookup, which returned the correct two question-level and one paper/page-level origins. Main answers were checked for the expected results: diver speed about 13.7 m/s; polynomial parameter a=4 and factorization 2(2x+1)(4x²+1); completed square 3(y−2)²−27.

For these same three public test images, the previous combined answer/source workflow completed in 13.67 / 12.65 / 5.88 s. New answer-only completion was 6.62 / 7.91 / 3.19 s; first answer delta was 5.31 / 6.39 / 2.46 s. Optional source lookup took an additional 4.83 / 4.75 / 4.82 s **only after confirmation**. These are small sequential, synthetic-auth, server-side measurements, not a controlled broad benchmark, steady-state SLA, or real-phone network test.

The client runtime is frozen at `e24529d887a94e5ff3da8d92765707499c4971a1`. Development version **1.0.59** was requested; the official tool returned pending user confirmation, not confirmed upload success. Formal review/public publication was not performed. Physical-phone testing remains NOT VERIFIED.
