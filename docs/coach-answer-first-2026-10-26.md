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

Deployment, live timing and development-upload receipts are pending; this pre-release document does not claim them complete. Physical-phone testing remains NOT VERIFIED.
