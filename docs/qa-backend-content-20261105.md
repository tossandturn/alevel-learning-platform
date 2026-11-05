# Backend-only content publication — 2026-11-05

## Outcome

At 16:40 China time, release/trial/develop all serve `backend-content-20261105-v1` from the existing product-config endpoint. No Mini Program upload, production build, service restart, Nginx change, authentication change, payment change, database migration or provider change occurred.

Publication SHA-256: `e21a81173ca2b6a7873d14cbb4ae4a736e4254d0b8eed40cc9aea6b854f6b9a8`; payload: 5,410 bytes. Source/preparation commit: `018691f6d181ede09ea0da7d190935003f80d0e7`. The new builder is publication tooling, not a new request handler. Existing application runtime was not overwritten.

## Fixed root cause

The active configuration `calculator-free-v1-20261030` had eight personas. A newer client still requested capability 1 but required nine; it rejected the entire configuration and reverted to bundled defaults. The same failure was reproduced using the actual frozen 1.0.92 validator.

The replacement has nine supported server personas, with their public copy projected from `tavernPresentation.js`. Horror uses an icon already available in legacy capability-1 clients. Home, Coach, information pages and categories from the active publication were preserved, including the free-calculator wording. Private character prompts, role secrets, conversation data and membership authority are never copied to this public document.

## Verification

- `npm run test:native-product-config`: PASS. Test-first missing-builder failure observed, then validated public projection, legacy-ID migration, supported icons, no duplicate roles, no mutation, preserved unrelated sections and schema rejection.
- `npm run test:product-config` in the unchanged client: PASS.
- `npm run test:tavern-stories`: PASS, including four-script/1–4-player journeys, private role books, staged clues, AI knowledge boundaries, image jobs and saved canon.
- `node scripts/test-coach-four-modes.mjs`: PASS after correcting two pre-existing stale assertions. Tests now assert the already-deployed saved-canon rule and absence of unearned hidden truth, instead of requiring unrestricted setting replacement and premature plot disclosure. No production prompt was altered for these tests.
- Frozen 1.0.44 and 1.0.92 × three channels: six offline integration combinations PASS for schema, loader, 304, invalid-response last-good, offline last-good, private-draft preservation and native Tavern projection.
- Same six frozen-client/channel combinations subsequently read the actual HTTPS publication: all return `source: network`, expected revision/hash and subsequent 304. This is not merely a mock endpoint test.
- Existing isolated native DevTools fixture used its original `refreshProductConfig()` against the real service, without recompiling. Nine personas and current names appeared; existing draft and message IDs remained unchanged. Both catalog portions were visually inspected at 390 × 753 native viewport. This is simulator acceptance, not a new physical-device test.
- STEM and IELTS public sites: HTTP 200 after publication.
- Client repository unchanged at `1a0b27f4ccd3dfe9fecd2f641cea8280bb9df92f`; no new development version assigned.

## Publication / rollback / health

Develop published and accepted at 16:34:47; trial at 16:36:42; release at 16:38:27 (China time). Each publication had a passing exact-target before/after readiness gate and expected-current compare-and-swap. Existing immutable old bytes were validated as the rollback target; no production rollback was necessary.

Before → after: available memory 2,408,132,608 → 2,430,124,032 bytes (61.7% → 62.2%); swap remained 8.66%; filesystem remained 77% used, more than 14.15 GB free; inodes 9%; three-sample I/O wait 0/1/0% → 0/0/1%. No build or backup jobs; application and configuration service identities/restart counts unchanged.

## Boundaries

See [backend-owned-content.md](backend-owned-content.md). Existing data/rendering capabilities can be updated on the backend; this does not install new client components. In particular, the prior composer-grid correction still belongs to the already-uploaded 1.0.92 client. Two newer advisor menu labels and decorative room-theme fallback text remain bundled; their next client capability update should make them optional versioned data, not require an otherwise unnecessary release today.

Operational receipts, public candidate/baseline snapshots, frozen-client results and native screenshots are retained in the local task QA folder `qa/backend-presentation-20261105`. It contains no service credentials or private student state. An ESM Windows path error and a shell-quoting error in temporary QA helpers were corrected before acceptance; the product code was not changed to hide either failure.
