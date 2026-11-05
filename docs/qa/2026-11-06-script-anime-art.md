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

## Production and visual acceptance

Deployed backend/art commit `476d05a5f12d9903e8606b74edc07e074d06904e` on 2026-11-06 (Asia/Shanghai). No Mini Program upload, dependency install, production build, payment change or IELTS service restart.

- Before/install/post readiness gates PASS. 55 allowlisted files match the pinned release; the four replaced modules have a checksum-verified rollback archive and all newly introduced file paths are recorded. No old image assets were removed.
- After the normal restart window, both products' loopback and public health endpoints returned HTTP 200 and remained stable. Only the STEM process restart counter changed.
- HTTPS delivery: all 48 WebPs return the expected MIME type and SHA-256, 6,597,742 bytes total.
- Authenticated synthetic accounts: five complete three-act journeys, lobby/active/vote/ended anime scenes, intact canonical endings, instant stock portraits and ensembles with no generation jobs. Stock actions measured 14–19 ms from the production host, not mobile end-to-end latency.
- Pre-deployment synthetic room: its identity, progress, evidence, dialogue and relationship state hash is unchanged after deployment; only presentation URLs change.
- Live Singapore `qwen-image-3.0` custom scene: approximately 28.8 seconds, two approved references, PNG output 1,100,531 bytes. The retrieved image was visually reviewed: the character's ponytail, indigo coat/light-blue blouse, anime line/shading style and rainy amber-lit setting are consistent with the prepared portrait/scene. This is one sampled result, not a guarantee of identical facial details for all future generations.
- Private custom image retrieval rejects another room member with HTTP 404; private request/image IDs are not present in that member's room response. Hidden/future request rejected before generation. No story stage advanced because of an image.
- Native simulator using frozen 1.0.92 presentation files: reviewed five book screenshots covering inline portraits, a two-person lobby and an ending. Initial automation timeout was traced to remaining on the home page; explicit navigation fixed the test setup. Images render within the message flow. This is a simulator check; physical phone/iPad rendering was not re-tested in this task.

Synthetic rooms were closed by their test accounts. No student rooms, credentials or private source images were copied into this repository.
