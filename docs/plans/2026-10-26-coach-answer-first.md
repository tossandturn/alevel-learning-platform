# Answer first, opt-in source lookup

User direction: do not identify the paper during answering; after completion ask whether to identify the year. Also improve perceived and actual reply speed.

- Normal academic JSON/SSE answers must not read the source index, transcribe for provenance, or append a source result. Return only a lightweight `sourceLookupAvailable` capability after a complete AI answer; keep a defensive filter for unwanted provider source claims.
- An authenticated, explicitly confirmed `/api/ai/coach/source` request uses the original question/photo snapshot. Typed input uses local retrieval; photos use one short transcription-only call followed by existing verified retrieval. No answer is generated again. Active exams remain blocked, errors sanitized, and original user data are not persisted by this flow.
- Native Coach and photo-feedback pages show an inline “是否识别这是哪一年的真题？” with “识别出处 / 暂不识别” after the answer, never during streaming. Only confirmation dispatches a request. Duplicate taps, stale pages, new questions, account/privacy changes and teardown cannot mix results. Source failures preserve the answer.
- Paint readable balanced streaming text/formulas promptly rather than waiting unnecessarily for a final paragraph/newline. Preserve incomplete-math guards and the distinction between a preview and a completed answer. Do not change IELTS, Tavern or provider credentials.
- Test answer-only zero-index/zero-transcription behavior, explicit lookup success/decline/error/auth/exam cases, native state lifecycles, current phone/tablet layout, package budget, and real configured-provider timings. Publish backend after fresh readiness/rollback gates; client buttons require a new development package.

Reference: [Vercel AI explicit tool approval](https://github.com/vercel/ai/blob/20c4031d1fc59aab54b67c16679e3981374690ab/packages/code-mode/src/tool-invocation.ts). Reference only; no package or implementation copied.
