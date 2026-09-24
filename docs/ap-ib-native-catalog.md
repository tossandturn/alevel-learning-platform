# AP / IB native catalogue

The Mini Program has separate AP and IB first-level entries. This catalogue is
independent of Cambridge route IDs, question indexes and competition catalogues.

## Data boundary

- `server/catalogs/curriculum-papers.json` contains source metadata only, not PDFs
  or extracted question text. It is immutable release content, not shared `data/`.
- AP uses the latest ten available year window (2017–2026). The current collection
  contains 54 FRQ paper entries, not complete secure MCQ exams. Coverage varies by
  course/year; a window does not imply every year is present.
- IB uses 2016–2025, the source's latest ten available years. AA/AI start in 2021;
  Physics has separate legacy and first-assessment-2025 paper codes. There are
  334 question papers and 333 candidate mark schemes.
- Variant labels are preserved from source filenames, not converted into canonical
  IB examination zones. Candidate and verified QP/MS associations stay distinct.
- No record is question-level practice-ready. `pairStatus=verified` only describes
  the source-paper association, not OCR, answer checking, copyright or AI marking.
- The current rights state is **unverified**. Metadata may be browsed; private/local
  collection is not evidence of public redistribution rights. Downloads stay closed.
  Official AP source links can be copied without mirroring the PDF.

## Reproduction

Read the live Windows clock and pass that timestamp/year explicitly:

```powershell
$liveNow = Get-Date
node scripts/build-curriculum-paper-catalog.mjs 'D:/CodexWork/ap-ib-source-discovery' 'server/catalogs/curriculum-papers.json' $liveNow.ToString('o') $liveNow.Year
node scripts/test-curriculum-paper-builder.mjs
node scripts/test-curriculum-paper-catalog.mjs
```

The builder prioritizes official AP downloads, reparses local AP cover headings
instead of trusting folder/classifier labels, excludes practice/support materials,
deduplicates hashes, and retains ambiguous associations as candidates. Original
files are untouched. The local audit file is outside the repository.

## File release

The file API must require a licensed record, verified integrity, a configured
external asset root, path containment and matching SHA-256. Merely changing the
Mini Program label must never enable a file. Any future release requires evidence
of the applicable license and validation of the exact source file and pair.

HTTP byte ranges support safe resumed downloads; the resource validator must
prevent mixing bytes from changed files. Reference:
[HTTP Range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests).

## Primary source policy checked

- [College Board permission instructions](https://privacy.collegeboard.org/copyright-trademark/request-instructions)
  distinguish linking from reproducing AP test materials.
- [IB licensing](https://ibo.org/become-an-ib-school/ib-publishing/licensing/)
  explains third-party product-use licensing.
- [IB source hub supplied by the user](https://ibmaster.cn/en/past-papers-hub)
  supplied the local per-file collection; it is not licensing evidence.

This feature does not migrate providers, modify shared authentication, alter
existing source governance or replace the whole-paper marking implementation.
