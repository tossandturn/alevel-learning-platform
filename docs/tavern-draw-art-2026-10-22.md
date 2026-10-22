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

Primary references: [Wikimedia Commons RWS collection](https://commons.wikimedia.org/wiki/Category:Rider-Waite_tarot_deck), [Fool source and rights](https://commons.wikimedia.org/wiki/File:RWS_Tarot_00_Fool.jpg), [Four of Wands source and rights](https://commons.wikimedia.org/wiki/File:Wands04.jpg). GitHub-first patterns: [TarotCards](https://github.com/mixvlad/TarotCards) and [hexagrams](https://github.com/urschrei/hexagrams); the latter's data was independently checked rather than copied. [Unicode hexagram chart](https://www.unicode.org/charts/PDF/U4DC0.pdf) was used only as an internal reference.
