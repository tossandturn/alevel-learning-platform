# Exact written-part evidence bindings

Status: `ROOT_REVIEWED_CODE_FIX_DATA_UNPUBLISHED_NOT_DEPLOYED`

Windows clock verified on 2026-10-05, Asia/Shanghai. Base commit:
`692402f97ce3543b8f278de74b425dc5141dbf32`.

## Repair

- Explicit opt-in `stem-ai-part-evidence-binding.v2` binds every written part to
  exactly one labelled QP region and one labelled MS region/page/hash/mark count.
- Shared coordinate grids remain separately labelled source evidence.
- Candidate and verification declarations must agree; missing, duplicate,
  unknown or ambiguous labels fail closed without positional inference.
- Real 0580 W25/12 Q19(c) now resolves to MS9 rather than MS8.
- Legacy multipart question display/practice provenance is retained, but
  incomplete part bindings do not grant AI auto-marking capability.
- The previous authority check is retained: a blocked answer binding cannot
  obtain practice provenance. Root reproduced the initial regression and
  independently verified the repaired behavior.
- Mini 1.0.33 may omit new fields; trusted exact context is derived from the
  canonical part server-side. Supplied mismatching fields are rejected. Signed
  marking grants retain exact binding fields. No client change was made.

## Prepared data, not released

Six Core 0580 transformation questions /13 parts/30 marks are prepared in a new
unpublished v2 data root. Three belong to P1 and three to P3. This does not
establish component-specific six-question readiness, vectors coverage,
Extended P2/P4 coverage or formal progress.

Manifest: `.candidate-evidence/0580-transformations-written-binding-v2-20261005/binding-v2-manifest.json`

Manifest SHA-256: `c9c1e32f2d04363419470807bac3715622743ec3d45f93e772ccd4f569d1383f`.

Every artifact remains unpublished, `studentStudyEligible=false`,
`formalProgressEligible=false`, with zero new provider calls. Original source
artifacts, QP/MS PDFs and pinned local Q21(b) sign adjudication were not changed.
The source sign annotation is not an official erratum.

Written/multipart independent-review v2 is **design-only**, not implemented or
approved. Six real independent whole-question reviews and new release bindings
remain necessary before data promotion.

## Independent checks

- Exact 0580 13-part binding suite: pass, including shared diagrams, no pre-submit
  key leakage and missing/malformed-label rejection.
- Controlled 0606 cross-page cases: pass in memory only. Original 0606 artifacts
  remain unmodified and are rejected by current canonical taxonomy.
- New exact Mini 1.0.33 attempt/capability test: pass; omitted fields derived
  server-side, supplied mismatches rejected, zero provider calls.
- Existing official mixed 9702 P1 MCQ/P2 written Mini cross-repo test: pass.
- Root actual 60-question Biology API regression: pass for source selection,
  cap-to-available, scoring, auth/ownership and hidden answers; legacy immunity
  semantic review hold remains explicit and is not overridden.
- Full `npm test`: exit 0 after generating the isolated clone's missing subject
  catalogs. The initial fixture failure log is preserved separately.
- `npm run lint`: exit 0, six existing warnings only. `git diff --check`: pass.

Root logs/reports are under
`D:/CodexWork/stemist-release-coordination/chapter-data-ready-20261005/`:
`full-test-written-binding-root-v2.log`,
`approved-chapters-api-60-written-binding-candidate.json`,
`written-binding-guard-review.json`, and `written-binding-guard-review-after.json`.

## Impact boundary

The bounded local chapter-20260927 audit finds 20 emitted local groups/39 parts;
11 groups/30 parts lose unsafe legacy AI capability while normal question
availability and practice provenance remain unchanged. This is **not a
production inventory claim**. Root compared the affected local artifact hashes
and paths with the previously captured 542-file live baseline pin: no exact
hash/path overlaps were found. No current production database/artifact contents
were read for this comparison, and no production capability count is claimed.

## Release boundary

No push, SSH, deployment, restart, swap action, OCR worker, paid model call,
student record access or client upload occurred in the implementation candidate.
Root controls any integration, push and later deployment. The latest complete
Singapore gate remains blocked by swap usage above 10%; this code/data work does
not authorize bypassing that gate.
