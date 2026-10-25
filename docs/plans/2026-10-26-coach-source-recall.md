# Coach source retrieval repair

User-reported failure: everyday question photos repeatedly return no source. The previous single-source happy-path acceptance did not measure recall.

## Evidence and acceptance

The deployed code matches the prior release. The existing index reads only eligible question-bank records, then requires near-complete literal strings. A read-only 24-record production sample matched 19 full texts, 5 after one common-word deletion, and 6 crops. The live bank supplied 818 eligible records, including unsupported Biology records. These are diagnostic samples, not overall product accuracy.

1. Add regressions for cropped question text, OCR word errors, equivalent formula spelling, question labels/figure captions, changed numerical givens, duplicates, generic prompts, and Unicode/JSON transcript boundaries. Preserve source authorization, exam mode, and no-model-guessed-source rules.
2. Use bounded token candidate retrieval followed by ordered text/numerical verification. Candidate ranking is not itself proof. Ambiguous origins remain ambiguous. Unreadable or too-generic prompts abstain.
3. Build a separate private, read-only source-page index locally from checksum-matched CIE catalog PDFs. Skip unusable text layers; record coverage and skips. This is source retrieval, not release of unreviewed questions/answers. Only canonical source records can assert an exact question number; PDF-only matches return the paper and verified page, with the question number explicitly unconfirmed.
4. Keep one existing vision/answer model request. Hide the transcription trailer in JSON/SSE, append verified metadata after completion, and never block or replace the teaching answer on index failure. Do not touch IELTS, Tavern, membership, or client runtime unless required.
5. Test broad known-bank samples, source PDFs not in the released bank, real cropped question images via the existing configured provider, and unrelated/modified/ambiguous negatives. Record timings and limitations separately from phone acceptance.
6. Review security, resource bounds, fresh readiness/rollback evidence, and deployed file checksums. Deploy only the bounded backend fix and private derived index; no production build or student database access.

Reference: [MiniSearch design](https://github.com/lucaong/minisearch/blob/master/DESIGN_DOCUMENT.md) illustrates candidate retrieval/ranking and small edit-distance tolerance. No code is copied, no dependency installed; strict provenance and numerical verification remain project-specific.
