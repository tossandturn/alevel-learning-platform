# Backend-owned native presentation implementation plan

> **For implementer:** Use TDD throughout. Write the failing test first, run it, then implement.

**Goal:** Restore backend-only publication for existing native capabilities without another Mini Program upload.

**Architecture:** Keep the deployed immutable product-config service and its CAS publication/rollback contract. Generate the public Tavern projection from the server-owned presentation registry, preserve unrelated live configuration, and prove that both legacy and current frozen clients accept the exact publication. Do not download executable JavaScript, HTML, WXSS, routes or arbitrary business commands.

**Tech stack:** Node ESM; existing public JSON service; native WeChat WXML/WXSS; isolated frozen-client tests.

## Evidence and scope

The active release/trial/develop revision has eight personas. Current clients require `horror-guide` as a ninth ID, but still advertise capability 1. They reject the whole live response and silently use bundled defaults. New icons are also versioned native capabilities: use an already-packaged compatible icon for the ninth persona, not a missing asset in older clients.

No payment, entitlement, login/privacy, academic/IELTS provider, question-bank authority or private conversation changes. No new client build or upload. The previous input-grid defect is still a client fix in the already-uploaded 1.0.92; a backend JSON change cannot patch old WXSS.

## Steps

1. Add `scripts/test-native-product-config.mjs`: assert a builder exists, eight-to-nine migration, stable IDs, canonical public copy, preserved Home/Coach/pages, no input mutation/private fields, no unknown role or unsupported icon.
2. Run `node scripts/test-native-product-config.mjs`; expect the builder assertion to fail.
3. Add `server/nativeProductConfig.js` and a preparation CLI. Require the deployed schema validator and packaged-icon allowlist; publication uses the existing service, not a second write API.
4. Re-run the focused test. Validate the output with the deployed schema, legacy 1.0.44 and frozen 1.0.92 validators, network loader/cache/304 and native-page projection. Invalid responses retain the last good config.
5. Record a capability inventory: currently server-owned, available native remote fields, and client-only gaps. Do not claim every UI label or layout is remotely configurable.
6. Inspect the exact config service/store; run a read-only resource/service/backup gate. Publish develop, verify real HTTPS and frozen-client reception, then trial and release with expected-current CAS. No restart/build/Nginx changes.
7. Verify each channel's revision/hash and 304 response, rollback coverage, service identities and post-change resource gates. Commit/push only scoped source/tests/docs and retain an operation receipt.

## Research

- Official WeChat examples: https://github.com/wechat-miniprogram/miniprogram-demo — native component and page boundary.
- Existing project foundation: `client/docs/backend-driven-foundation.md`; the deployed service already supports immutable revisions and channel-specific rollback.
- Direct WeChat documentation fetch was unavailable in this session. No new platform-policy claim is based on an inaccessible page.
