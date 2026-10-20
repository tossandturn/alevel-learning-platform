# Tavern-only DeepSeek implementation plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** Move only recreational Tavern chat to official DeepSeek Flash with thinking disabled, preserving academic Coach, vision/PDF marking, authentication, history and existing Mini Program compatibility.

**Architecture:** Add a server-owned Tavern provider configuration independent of the shared Coach configuration. Environment configuration or an owner-private runtime settings file enables the route; missing/invalid explicit settings fail closed for Tavern only. The existing single-call media JSON contract, conversation transactions and replay remain unchanged. No new client upload, database migration, dependency or server build.

**Tech Stack:** Existing Node ESM HTTP service, native fetch/SSE, SQLite conversation store; current WeChat Mini Program.

User approved the provider switch after bounded synthetic benchmarks. No further scope approval is needed for this isolated change.

## 1. Routing and protocol regression

- Create `scripts/test-tavern-deepseek-api.mjs`.
- First assertion: configured Tavern request returns `provider: deepseek`, while academic requests remain on their old model.
- Run `node scripts/test-tavern-deepseek-api.mjs`; expect RED before implementation.
- Modify `server/aiApi.js`: select a dedicated provider only after validated `feature === tavern`; wire both regular and stream routes; send `thinking: {type: disabled}` for DeepSeek; use JSON object mode only for the existing non-streaming media contract.
- Test old-client text, canonical media/replay/history, failure/retry without duplicate turns, stream protocol and no fallthrough to the broken shared gateway.

## 2. Safe configuration

- Create `scripts/test-tavern-provider.mjs` and `server/tavernProvider.js`.
- Default remains legacy when no dedicated route is configured; a DeepSeek key alone must not silently enable routing.
- Dedicated settings support `STEM_TAVERN_PROVIDER=deepseek`, with an in-process environment credential, or an owner-private `~/.config/stemist/tavern-provider.json` referring only to `deepseek.key` beside it.
- Settings schema: `stem-tavern-provider.v1`; provider `deepseek`; model `deepseek-flash`; endpoint fixed to official `https://api.deepseek.com/v1`.
- Enforce bounded regular files, no final-component symlinks, owner-only Linux permissions and same-directory fixed key filename. Invalid explicit settings disable only the Tavern provider, without logging values.
- Test missing, disabled, malformed, oversize, missing key, unsafe key path, symlink and broad-permission cases.

## 3. Long-history compatibility

- Add the documented `deepseek-flash` 1M context window to `server/tavernConversationStore.js`; no history deletion or fixed round limit.
- Test the model mapping and preservation of old canonical history/media.
- Run existing Tavern memory, divination, media and Coach policy/stream suites.

## 4. Delivery

- Commit and push allowlisted source/tests/docs, retaining unrelated files.
- Before each server mutation, require current resource/service gate, exact old source hashes, enough space and verified code rollback.
- Provision only the new, bounded Tavern credential through encrypted SSH stdin from the existing local environment. Never print it, embed it in a command, write it locally, or change existing application secrets.
- Package only three changed runtime files; activate atomically with code-only rollback. Restart only the existing STEM process with its environment preserved.
- Verify both sites, unchanged academic provider fields, dedicated Tavern provider/model, actual native replies with media and history, and measured response time. Roll back if acceptance fails.

References (checked 2026-10-20): [DeepSeek request format](https://api-docs.deepseek.com/), [thinking toggle](https://api-docs.deepseek.com/guides/thinking_mode/), [model context](https://api-docs.deepseek.com/quick_start/pricing/), [original provider adapter](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/llm/llm-deepseek). No third-party implementation copied.
