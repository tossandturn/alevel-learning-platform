# Tavern reply media v1

User-approved direction: AI chooses original pre-made stickers and illustrations; no per-turn image-generation API. The user explicitly requested a large library.

## Contract

- Native client sends `mediaVersion: "tavern-media.v1"` on the existing non-streaming Tavern request. User input is still text-only; academic attachments and client-owned persona prompts remain rejected.
- Server selects at most 16 relevant catalog candidates. One normal provider call returns `{"text":"...","media":["catalog-id"]}`. The server validates IDs against those candidates, limits output to one sticker plus one picture, and discards unknown media while retaining valid text.
- Bare text remains supported. Malformed structured output never appears as raw JSON. Existing text-only clients and the streaming route keep their prior text behavior.
- Accepted descriptors are saved atomically in the existing `memory_json.replyMedia` field. There is **no database schema migration**. Their bytes count toward logical content quota. Reply replay, paging and ownership use the existing canonical store.
- Media URLs point only to immutable, checksum-verified catalog files under `/api/ai/tavern/media/v1/`. No model-provided URL, data URL, path traversal or symlink is accepted. Artwork is public; no student image or private conversation is served through this route.
- Catalog changes are checked every five seconds, invalid manifests retain the last valid catalog. Publish images first and replace the catalog atomically last. Preserve all existing IDs, descriptors and hashed files so old conversations retain their exact media.

## Initial library

96 distinct sticker frames across eight original 4×3 atlases, plus 12 original scene illustrations: **108 catalog entries, 20 image files, 2,900,611 image bytes**. Frames are different expressions, not resized duplicates. Generated with the built-in image tool; no third-party art was copied. Exact prompts and hashes are recorded in `public/tavern-media/v1/provenance.json`.

The client does not bundle the full library. It loads only returned media, reserves image geometry, reuses immutable URLs and supports an error/retry state. A sticker atlas supplies twelve cached frames; picture taps preview only the selected original illustration.

## Verification

- PASS: `node scripts/test-tavern-media.mjs` (catalog bounds, IDs, whole-word English retrieval, model envelope validation, bad-media fallback, catalog reload, canonical persistence/replay, owner isolation).
- PASS: `node scripts/test-tavern-media-api.mjs` (isolated HTTP/provider fixture, prompt capability, reply/history/replay, public immutable asset, invalid capability and old-client compatibility).
- PASS: `node scripts/test-tavern-media-assets.mjs` (108 unique catalog visuals, 20 file hashes and JPEG dimensions, bounded files).
- PASS: existing Tavern long-memory, divination, Coach four-mode, answer-policy and stream-protocol suites.
- Synthetic-provider verification is not a live-model or production claim. Server rollout and public acceptance receipts live in the private task artifact directory; never copy secrets or user data into this document.

Design references: [SillyTavern expression catalog documentation](https://github.com/SillyTavern/SillyTavern-Docs/blob/main/extensions/Expression-Images.md) for categorized variants, and [TDesign attachment types](https://github.com/Tencent/tdesign-miniprogram/blob/develop/packages/pro-components/chat/attachments/type.ts) for explicit attachment states. No implementation or assets were copied.
