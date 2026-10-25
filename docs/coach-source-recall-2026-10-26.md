# Coach source recall repair

## Root causes

The prior source feature was too narrow for ordinary photographed questions. It required almost literal whole-question overlap, indexed only eligible exercise-bank text, omitted printed MCQ options, and treated concise editorial prompts as though they were verbatim page text. Raw PDF content-stream order also scrambled coefficients and superscripts in maths. A passing single-photo fixture was not broad recall acceptance.

## Behavior

- Bounded token retrieval selects candidates; ordered wording and numeric verification are still required. Normal OCR misspellings, omitted common words, cropped passages, equivalent spacing/LaTeX and complete MCQ options are supported. Changed givens/signs/coefficients do not match merely because the surrounding prose is similar.
- Canonical exercise records can report the question number. A separate checksum-bound source-page index can locate the original paper without claiming the question is released for practice or automatically inventing a question number.
- PDF-only matches show year, session, paper code, filename and **PDF page**, explicitly saying the question number is unverified. Reused passages produce multiple candidate origins rather than one invented date.
- The private index is generated locally from source PDFs that match the catalog SHA-256. Source PDFs are checked again on the server when a candidate is used; changed/missing originals invalidate the match. It stays outside the public root. No student uploads, conversations or user database data enter it.
- No second OCR/model request, provider setting change, new dependency, question-bank release, IELTS/Tavern change or client runtime upload is required. Retrieval runs after the existing photo transcription; it must not replace or block a successful teaching answer when the index is unavailable.

## Evidence

- Before/after on the same 24 existing-bank records: full text 19 -> 23 matched; one omitted common word 5 -> 23; arbitrary character crops 6 -> 18. These are diagnostic fixtures, not overall product accuracy. Biology metadata support also fixes four records in this sample.
- Source index: 1,834 catalog PDFs inspected, 1,437 usable papers / 17,714 pages, 2,316,432 compressed bytes. 397 files were skipped rather than indexing unusable text layers or invalid sources. Six supported math/physics subject codes: 0580, 0606, 0625, 9231, 9702, 9709. All 1,437 indexed source checksums were independently verified against server originals.
- A 72-page local text benchmark, sampled across six subjects, returned 53 unique matches, 13 ambiguous matches and 6 abstentions for full text, omitted-word and word-crop variants. Candidate lists are intentionally capped, so a known origin may not appear in the first three displayed alternatives. All 27 changed-numeric-given negatives abstained. This is text-layer retrieval testing, not camera OCR accuracy.
- Five real-provider image requests exposed the MCQ/options and maths transcription problems during development. Replaying those captured public-image transcripts after the fixes gives three exact question origins, one correct original-paper/page origin, and an appropriate abstention for a formula/data reference page. Replay is not an additional live provider run.
- Local warm source retrieval in that benchmark: up to 8 ms; initial cold index construction about 0.85 s. The source-index benchmark process RSS was about 297 MiB. These are individual local measurements, not a phone or production latency guarantee.
- Eighteen focused backend suites pass, including HTTP/SSE private-trailer stripping, answer/failure/deadline handling, source authorization, source-index corruption and original-checksum invalidation, numeric/sign negatives, and Tavern regressions. Deployment allowlisting, stale/blocked gate rejection, backup hashing and recoverable rollback are tested separately.

## Limitations

Short generic prompts, purely symbolic expressions with insufficient identifying context, ambiguous reused questions, translations, unreadable/obfuscated un-OCRed pages and papers not in the source library can still be unconfirmed. This is not a universal AP/IB/CIE image search. Physical-phone acceptance and the user's particular failed image are **NOT VERIFIED**; the supplied screenshot was the old feature description rather than the question itself.

## Reference

[MiniSearch's original design](https://github.com/lucaong/minisearch/blob/master/DESIGN_DOCUMENT.md) informed the separation of candidate retrieval, ranking and small typo tolerance. No implementation was copied and no library installed. Final evidence checks are project-specific and deliberately stricter than search ranking.

## Deployment

Pending final release checks; no deployment claim is made by this document's pre-release version.
