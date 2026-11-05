# Script art acceptance — 2026-11-06

## Produced

48 original, individually generated and visually reviewed 2D anime assets: 15 scene backgrounds, 18 adult character portraits, 10 decorative props, 5 neutral ensembles. Delivery WebP payload is 6,597,742 bytes total. Full original PNG outputs are retained outside Git with generation provenance; only reviewed, hashed delivery derivatives are published.

Production used the built-in `image_gen` tool, one image per asset. The base production prompts and visual canon are in `server/scriptArtSpec.js`. Generation added explicit reference instructions: each book scene/portrait/prop reused its scene reference; ensembles reused the individual portraits and book scene. The accompanying manifest records delivery hashes/dimensions. No copied characters, external art dependencies, ambient audio, secrets, or student data are included.

## Local acceptance

- `npm run test:script-art`: 48-file integrity, cast identity, genre coverage, catalog scope, stock lookup, stage gate, no provider work for stock, private channel isolation, runtime reference URL allowlist, Singapore endpoint payload, anime style lock.
- `npm run test:tavern-stories`: existing 1–4-human journeys, editions, cross-act memory, role permissions, case/romance rules, durable image tasks and image-provider safety.
- Frozen client 1.0.92 / 83b8d9f: 45 view states across five books, including lobby, three acts, inline portraits, voting and ending. Existing image rendering consumes the new server URLs; no client upload is required. This contract check is not a real-phone rendering test.
- Pinned story-definition hashes remain unchanged. The art layer does not rewrite persisted stories/messages or advance clues, relationships or decisions.
- The non-play `act` response is a presentation preview only. It has no puzzle or actionable objective; phase checks remain authoritative. Historical confirmation flags are not shown as pending player confirmations after the play phase.

## Behavior

Examples: “看看许知夏的立绘”, “看看白色纸袋的图片”, “看看全员合影”, “看看当前场景”. Specific/custom poses use the existing recoverable image job with up to three approved current-book references. Ordinary Tavern media selection excludes script art. Art remains decoration, never evidence.

Generic window details are allowed; explicitly requested future acts/locations and hidden answers are refused before generation. Runtime AI image consistency is guided by references and fixed visual canon, not a claim of perfectly identical pixels on every generation.

## Sources

- [Qwen image unified API](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference): compatible image generation endpoint accepts the top-level `image` reference array; Qwen 3.0 supports up to three references.
- [Original Qwen Image project](https://github.com/QwenLM/Qwen-Image): reference-based character/style consistency. No source code or model weights were incorporated.

Production deployment and live-provider results are recorded separately after acceptance; local success is not proof of release.
