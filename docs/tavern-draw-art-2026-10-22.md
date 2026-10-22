# Canonical Tavern draw artwork

Date: 2026-10-22. Scope: image delivery only; draw randomness, IDs, orientations, expiry, interpretation, model settings, authentication and IELTS remain unchanged.

The public `/api/ai/tavern/draw-art/v1/` namespace exposes a validated manifest and only its immutable image files. All 78 IDs from `TAROT_DECK` and 64 from `HEXAGRAM_DECK` must be represented exactly once. Files are digest-named, size-bounded, checked before serving, with JPEG/PNG content types, nosniff and immutable cache headers. The manifest is short-cached and preserves the last complete known-good revision if a refresh is malformed. Unknown paths, tampered files, symlinks, traversal and unsupported methods fail closed.

## Artwork and provenance

- 78 classic Rider-Waite-Smith images, artist Pamela Colman Smith. Every source file's Wikimedia Commons imageinfo record was checked as Public domain. The downloaded source-provided 500px JPEG thumbnail bytes are unchanged. Original file SHA-1, description page ID, source title, license URL, downloaded URL and SHA-256 are retained in `public/tavern-draw-art/v1/provenance.json`.
- 64 original STEMist PNG diagrams, generated from vector rectangles and text. Six lines are bottom-to-top in data, rendered top-to-bottom; independent 8×8 King Wen matrix and decoded PNG pixels verify every yin/yang line. No Unicode chart/font data is redistributed.
- 142 images, total 20,716,026 bytes; not bundled into the Mini Program. Only drawn images are fetched by the client. Diagram generator and rights-aware import script are local build tooling; no new production dependency.
- An initial Soimoi CC BY candidate was rejected after contact-sheet review found unsuitable minor-card scene correspondence. It was moved to a task-local backup, never published. It is not part of this release.

Credits are returned with the manifest and shown in the client viewer, including copyable source/license links. Reversed cards are displayed with a client rotation only, keeping downloaded bytes and canonical draw receipts unchanged.

## Verification

PASS: `test-tavern-draw-art.mjs`, `test-tavern-draw-art-assets.mjs` (local Sharp supplied as a tooling argument), original divination/media API tests, Tavern DeepSeek isolation and STEM DeepSeek isolation. New read-only routes also pass a local real HTTP `createAiApi` integration test without a provider call. All 78 Tarot images were visually reviewed in contact sheets, not merely counted by filename.

Deployment uses pinned allowlisted code/assets, verified rollback and fresh server gates. No database migration, source build, dependency installation, Nginx/model/secret change is required. Deployment and physical-device acceptance are separate from these local tests and must be recorded in a release receipt.

## Deployment receipt, 2026-10-22

Backend overlay `49fb788cd3e91b27714528bdbb08d11f4e28abf0` is activated and hash-verified (147 allowlisted files); the base build identity is unchanged. Archive SHA-256 is `2699b8a303e5f13e992283293d8235dfcac5a8e937b74af119692234635628e7`, size 20,095,402 bytes. Exact-target resource/rollback gates passed before upload and after upload, activation and restart. Only the STEM service restarted; IELTS and shared services were preserved. No source build occurred.

Post-restart available memory was about 2,324 MiB, swap 9.5%, filesystem free 7.73 GiB and I/O wait 0.5%/0%/0%. STEM and IELTS health endpoints returned 200. Every image was subsequently checked over public HTTPS for exact digest, MIME and caching (142/142), from both a workstation diagnostic route and the server route. These are not phone-speed measurements.

Local evidence: `D:/CodexWork/tavern-draw-art-20261022/gate-after-restart.json`, `public-assets-result.json`, `server-https-assets-result.json`. Real authenticated server Tarot and hexagram draws were rendered with the matching images in the isolated official WeChat simulator. Private history/model interpretation calls were intentionally blocked during this image-only acceptance. Physical-device pinch gestures remain separately unverified.

Primary references: [Wikimedia Commons RWS collection](https://commons.wikimedia.org/wiki/Category:Rider-Waite_tarot_deck), [Fool source and rights](https://commons.wikimedia.org/wiki/File:RWS_Tarot_00_Fool.jpg), [Four of Wands source and rights](https://commons.wikimedia.org/wiki/File:Wands04.jpg). GitHub-first patterns: [TarotCards](https://github.com/mixvlad/TarotCards) and [hexagrams](https://github.com/urschrei/hexagrams); the latter's data was independently checked rather than copied. [Unicode hexagram chart](https://www.unicode.org/charts/PDF/U4DC0.pdf) was used only as an internal reference.
