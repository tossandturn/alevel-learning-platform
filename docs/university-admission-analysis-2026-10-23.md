# International undergraduate admissions analysis

## Scope

The user selected **official requirements plus qualitative AI advice**, not estimated competitive score ranges. Every one of the 184 university profiles now has six ordered dimensions: A-Level, IB, AP, language, competition, and research/projects. These cover the 210 ranking rows without merging different campuses.

This is not a claim that every school's requirements have been verified: **55 schools have at least one sourced dimension; 86 dimensions have reviewed source-backed information; 1,018 dimensions remain explicitly unverified**. Unverified never means not required. No guessed cutoffs, mandatory medals, publications, paid research packages or admissions probabilities are generated.

## Evidence and interpretation

- New reviews are in `server/catalogs/university-admission-reviews.json`; source URLs and review dates are preserved in the public provenance artifact.
- Existing verified language prose is reused intact with its sources and qualifications. The original source catalog and legacy sections are unchanged.
- Oxford, Cambridge, Imperial, UCL, King's, LSE, Manchester and CUHK illustrate why academic totals, subject prerequisites, SAT/ACT combinations, eligibility minima and course offers must remain distinct.
- Penn, MIT, Harvard and Stanford are not assigned a ranking-derived A* / IB / AP cutoff. AP credit conversion is not used as an admissions threshold.
- Language minimums, institutional recommendations, competitive-applicant descriptions, exemptions and conditional-language pathways remain distinct.
- AI advice is an independently labelled qualitative field, precomputed with the profile. Opening a profile does not invoke a model or send a student's grades anywhere.

Research exclusions: university test/template URLs, old prospectuses, graduate-only requirements, unrelated uses of “holistic”, and unaudited keyword harvests were not promoted. Several primary pages rejected direct retrieval; only inspected official search excerpts or previously hash-verified public-page snapshots were used. UCL's query-dependent country table was not added as a public link because the existing client contract rejects query URLs; its module links to the official course requirements for qualification-specific lookup instead.

## Compatibility and release boundary

- Optional `analysis` metadata extends the existing v1 profile. A saved 1.0.57 normalizer accepts all 184 new profiles and continues to show legacy sections; the new client reads all six modules.
- New profile URLs are content-addressed. `university-profile-retention.json` pins the previous 184 reviewed files so cached old indexes keep working.
- 168 logos and 145 official programme links are unchanged. Maximum new profile is 4,911 bytes, below the 16 KiB cap.
- Local builder creates a fresh review folder; a separate staging helper validates files before copying immutable additions and promoting local metadata.
- Production delivery must be static-data-only with resource, source, rollback and compare-and-swap gates. No restart, dependency build, model, IELTS, payment, database, or question-bank change.

## Verification

Backend contracts, all ranking aliases, exact hash/asset allowlist, six dimensions, source binding, malformed-source rejection, no numeric AI advice, and legacy/client compatibility pass. Source/transformed Mini Program suites and 72 responsive geometry cases pass. The official native simulator verifies tabs, cross-ranking aliases, six modules, source copying and failure/retry. Physical phone and tablet remain **NOT VERIFIED**.

GitHub UI reference: [Tencent TDesign Mini Program tabs](https://github.com/Tencent/tdesign-miniprogram/blob/develop/packages/components/tabs/type.ts), MIT-licensed original implementation. Reference only; no dependency or third-party code was copied.
