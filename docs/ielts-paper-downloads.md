# IELTS paper downloads

The shared STEM download gateway now hosts a separate Cambridge IELTS catalogue. IELTS learning, scoring, realtime speaking, model configuration and user identity remain unchanged.

- `GET /api/stem/ielts-papers`: public catalogue, reloads when the versioned manifest changes. Optional `book`, `module`, `kind` filters.
- `GET|HEAD /api/stem/ielts-papers/files/{id}`: only content-addressed PDF objects in the trusted catalogue. Verified size, magic and SHA-256, private response, range/ETag/If-Range, sanitized errors. No user-selected path or upstream URL.
- New native entry uses authenticated quota-capable requests. It always applies the existing `pdf_download_grants` ledger: two distinct files per Beijing day, same-file retry/range reuse, actual current membership grants unlimited downloads. Metadata/304/416 do not consume. Existing CIE/AP/IB compatibility rollout flags are **not changed**; all-product enforcement still requires publishing a compatible client.
- Download receipts and cache are scoped to current account/privacy epoch; local verified cache opens without network/quota charge. No shared STEM token is sent to the IELTS origin.
- Default storage in release layout: the STEM deployment's own `data/ielts-downloads/current`, pointing to a versioned immutable asset directory. Content updates replace this pointer/manifest; no client rebuild is needed for additional files. `STEM_IELTS_DOWNLOADS_ROOT` is a server-only override for isolated tests/builders.

## Initial source export, 2026-10-29 (Asia/Shanghai)

Cambridge 4-21: 360 source question PDFs (72 listening, 72 reading, 144 writing, 72 speaking), 144 listening/reading answer PDFs. Writing/speaking have no unique answer keys; no fabricated model answers are added. Cambridge 1-3 remain outside the existing complete-source library.

Original registered page images remain in original page order; diagrams and all page content are retained. PDFs are below the existing 32 MiB download/cache file bound, with descriptive book/test/module/question-or-answer filenames. Book 12 uses original Test 5-8 and separately exposes the existing site's practice index 1-4.

Three formerly incomplete reading answer exports use inspected original answer-page images: Cambridge 4 Test 4 document page 159, Cambridge 9 Test 1 document page 145 (printed 153), and Cambridge 12 site Test 3/original Test 7 document page 121. Original Cambridge 9 Q6 is TRUE, whereas the old source row contained NOT GIVEN and was unavailable. This fixes the downloadable key via original source evidence; it does **not** silently alter IELTS practice scoring or its question-bank flags.

Release metadata, rendering evidence and source page hashes are in the local task artifact bundle. Do not commit PDF binaries, student data or databases.

## Verification

`node scripts/test-ielts-paper-downloads.mjs`; existing quota, policy, cross-connection concurrency, auth and hosted download route tests. Native client full tests, frozen package and real endpoint acceptance are separate release gates.

Reference: [pillarjs/send](https://github.com/pillarjs/send/blob/092f3fc77f0e796519ac328c543c11cced8f2244/README.md), Range and conditional delivery behavior. No copied implementation or new runtime dependency.
