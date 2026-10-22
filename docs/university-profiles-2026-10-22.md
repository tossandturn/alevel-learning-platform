# University identity and undergraduate admissions data

## Scope and coverage

This adds a separate public enrichment namespace. Existing QS/U.S. News ranking data, exam-board links, campus identities and ties are unchanged.

- 210 ranking rows resolve to 184 institution profiles through explicit aliases.
- 168 institution images are included. The remaining 16 use a client-rendered school-name initial, not a fabricated or unrelated logo.
- 38 profiles contain reviewed, source-linked school/system-specific overviews. The other 146 are explicitly labeled general preparation guides, not school-verified offer thresholds.
- 145 profiles have a reviewed official programme/course entry link. All profiles retain at least an official school/reference source.
- Payload: 354 files, 3,761,694 bytes. Images stay on the backend and do not enter the Mini Program package.

The requested scope is **general international-undergraduate requirements plus official programme links**, not mathematics/physics-specific offers. Minimum eligibility, standard offers, competitive language guidance, test-optional policy and programme-specific requirements are not interchangeable. Profiles state their scope, checked date and official sources; no admission probability or guaranteed outcome is invented. Some overviews cover language/testing/material requirements rather than every academic qualification: the displayed scope makes this explicit.

## Public contract

- `/data/university-profiles/v1/index.json`: bounded metadata, ranking aliases, content-hashed profile/image paths, overview kind and concise summary.
- `/data/university-profiles/v1/profiles/<id>-<digest>.json`: structured sections, references, scope and review date.
- `/data/university-profiles/v1/logos/<id>-<digest>.<png|jpg|svg>`: reviewed identity artwork.
- `/data/university-profiles/v1/provenance.json`: source URLs, hashes, attribution/licence metadata where supplied, and portability/extraction records.

The native client fetches this independently of the ranking directory, renders only the visible page's images, lazily loads details, coalesces requests and isolates stale results after navigation. Index cache freshness is five minutes; bounded offline metadata/detail caches are at most seven days and keep 20 detail records. The AP/IB/A-Level official-links tab does not fetch unrelated enrichment data.

## Source and artwork review

Official website imagery and public-domain/CC0 Wikimedia files were used for institutional identification. All delivered images were visually inspected in contact sheets and decoded for file validity and dimensions. Campus photographs, social-media icons, consortium marks, magazine/faculty sub-brands and campaign slogans mistakenly returned by automatic discovery were rejected. Unknown/unavailable or clearly restricted assets remain text fallbacks; they were not substituted with invented marks.

Known restrictive guidance includes [NUS identity terms](https://nus.edu.sg/identity/), [Melbourne brand guidance](https://brandhub.unimelb.edu.au/resources/governance/advice-for-students) and [Pepperdine logo availability](https://community.pepperdine.edu/imc/resources/style-guide/logos/university-wordmarks.htm). School marks do not imply partnership, endorsement or ownership by this application.

Raster pixels were not redrawn or resampled. Original PNG frames/embedded raster bytes were extracted unchanged where necessary. A few source SVGs needed code-level portability fixes: safe constant colour entities expanded, external DTD declarations removed, an incorrect encoding declaration corrected, or a missing namespace added. Their original hashes and transformations remain recorded. Colours and proportions were preserved; reverse logos use a dark surrounding frame.

SVG/script/external-resource guards, safe URL rules, size bounds, checksums and content-addressed filenames are enforced. Logo files use the scoped `binary` attribute (`-text -diff -merge`) in `.gitattributes` so Git cannot silently rewrite source SVG line endings and invalidate their hashes. Third-party indentation is retained; code/data whitespace checks remain enabled elsewhere, while image checksums and visual review validate the actual artwork.

GitHub-first implementation references: [Hipo university domain list](https://github.com/Hipo/university-domains-list) and [Tencent TDesign Mini Program](https://github.com/Tencent/tdesign-miniprogram). These informed identity/layout choices; no library dependency or unlicensed bulk logo collection was imported. Requirements sources are recorded per profile, including official MIT, Oxford, Cambridge, UCL, Harvard, Yale, Stanford and other admissions pages.

## Backend-only editing workflow

1. Update `server/catalogs/university-profiles-source.json` from checked official sources. Keep `preparation-guide` unless each institution-specific section has supporting source IDs. Record the actual verification date, applicant category and relevant intake.
2. Add any reviewed image with its digest filename under the logo directory and preserve provenance/rights information. Do not reintroduce rejected visuals or assume public visibility grants endorsement rights.
3. Run `node scripts/build-university-profiles.mjs --out <new-review-folder>`; the builder never deploys or overwrites an existing output folder.
4. Run `node scripts/test-university-profiles.mjs`, `node scripts/test-university-profile-assets.mjs` and the original directory test, plus client contract parity and visual review for changed images/text.
5. Publish pinned prebuilt data only after fresh exact-target readiness/rollback checks. For later revisions, add new immutable files first and atomically update the index; retain previously referenced immutable files through the cache window unless explicitly revoked. Never overwrite a hashed asset with different bytes.

Daily content, source links and imagery can then change on the backend without another client upload. New native interactions/components still require a client release.

## Verification and release boundary

Local data/URL/campus coverage tests, all 354 artifact digests, the original directory regression, deterministic rebuild, and client normalization of all 184 profiles pass. Isolated deployment tests cover activation/rollback, stale/failed gates, source changes, archive tampering, existing namespace collision and traversal. No production dependency, model, payment, database or IELTS change is involved.

Evidence lives in `D:/CodexWork/university-profiles-20261022/`. Deployment/public HTTPS/native acceptance is recorded separately; local PASS alone does not assert production deployment or physical-device acceptance.

## Deployment and public acceptance — 2026-10-22

Data commit `d586912ffd96755fce098598b36cc3a564d7f052` was packaged without production compilation as `university-profiles-20261022-d586912.tar.gz` (2,691,736 bytes, SHA256 `79204e44a7275cc2b06021b0e0661ddf3afc28c0f1939a9702a6bb9b7bb7b325`). All 354 packaged file bytes matched their Git objects and approved artifact hashes.

The new namespace was activated at 2026-10-22 21:55:15 Asia/Shanghai (13:55:15 UTC). Exact-target read-only readiness gates passed before upload, after upload, before activation and after activation. After activation, available memory was 2335 MiB and swap use 9.5%; disk, inode, I/O, ownership and rollback checks passed. Original protected hashes and all service PID/restart tuples stayed unchanged. No service restart, current-release switch, dependency install, database, payment, model or IELTS modification occurred. An exact-scope rename rollback marker and stage receipt are retained on the target.

`operation-verify.json` confirms all 354 deployed filesystem hashes. `public-acceptance.json` confirms all 354 files through public HTTPS with expected content types and full byte hashes. The official native WeChat simulator loaded real MIT/Cambridge/Harvard profiles, displayed raster/SVG institution marks, copied the official programme link, recovered from an injected profile-fetch failure, and preserved cross-ranking aliases and the AP official-links route. This does not certify physical phone/iPad behavior or mainland mobile throughput.

Earlier transient SCP/direct-SSH failures were followed by a read-only residual-file check. The completed release used one bounded persistent standard SSH transport through the existing local per-command proxy, with fresh gates between phases; no global network/SSH configuration was changed. Those failed attempts were not mistaken for activation or upload success.

Public index: https://stem.ieltsist.com/data/university-profiles/v1/index.json
