# Script anime art library and consistent runtime generation

> Use TDD for runtime changes. Generate one built-in ImageGen image per asset; preserve source outputs, inspect them, then package approved WebP assets.

## Scope

Existing five scripts. First pack: 48 original images — 15 chapter locations, 18 character portraits, 10 common props, 5 neutral cast ensembles. All use the same mature 2D anime visual-novel style, with per-book lighting/palette and stable character appearance. No copied IP, text clues, hidden answers, gore, imposed player actions, or ambient audio.

Pre-made matching requests return existing art without a provider call or paid real-time quota. Custom requests use the existing Singapore image provider, the same art direction and up to three trusted reference images. Images remain illustrations, not evidence. Future chapters, private channels and actor identity stay server-controlled.

## Delivery

- Keep original story snapshots and old art files; add an independent visual layer, hashed image URLs and a library manifest.
- Use existing room messages/image UI, not a new gallery page. Inspect frozen-client cover/lobby/active-room behavior; disclose any baked-in client limitation instead of claiming a backend patch can change packaged constants.
- Validate exact file hashes, stock lookup vs real-time intent, no clue/phase mutation, private image access, reference allowlist, regional API transport and mixed-style prompt injection.
- Local and frozen-native checks, visual contact sheets, then a scoped deployment after fresh server readiness/rollback gates. No production build or unrelated provider/service mutation.

## References

- [Official Qwen image API](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference): same `/images/generations` endpoint accepts `image` URL(s); Qwen 3.0 supports 1–3 references. This is an implementation reference, not a source of art.
- [Original Qwen image project](https://github.com/QwenLM/Qwen-Image): character/style reference consistency. No model installation or code dependency added.

The built-in image generator is used for the project art pack. The existing application's configured API remains the runtime image provider; keys stay server-side.
