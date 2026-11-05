# Native client / backend content ownership

## Operating rule

Prefer the existing backend response or public product configuration for content changes. Do not edit client defaults as the primary publication mechanism. A bundled default is an offline fallback, not a second live editorial source.

Do not add remote script execution, arbitrary WXML/WXSS, authentication logic, entitlements or unrestricted route dispatch to the public configuration. Public presentation is not authorization.

## Current boundary (verified 2026-11-05)

| Content / behavior | Authoritative source | Client upload needed for content changes? |
| --- | --- | --- |
| Tavern persona voice, history, experiences, story canon and reveal rules | `server/tavernPersonas.js`, `tavernCharacterLives.js`, `tavernStoryBible.js`, `tavernStoryState.js`, `tavernStoryPerformance.js` | No |
| Tavern name, short description, greeting and starter topics | `server/tavernPresentation.js` → `nativeProductConfig.js` → existing public config service | No, within the existing native capabilities |
| Four script games: public synopsis, roles, private role books, stage opening, objective, clues, puzzles, outcomes | `scriptGameCatalog.js`, `scriptRoleCards.js`, `scriptRoleBooks.js`, `scriptRoomStore.js` | No, for data represented by existing room components; keep per-room version binding |
| Current-act illustration, message images, requested generated images | Existing server media/image jobs and authenticated room responses | No; keep current-stage and ownership checks |
| Home: six existing entries' wording/order, secondary links | Existing `/api/product/config` schema v1 | No |
| Four original Coach menu cards' wording/order | Existing `/api/product/config` schema v1 | No |
| Information pages composed of text, notices and allowlisted links | Existing `pages` configuration and native configured-page renderer | No |
| Announcements, paper/audio inventory, chapter content, university/curriculum information | Existing respective backend APIs/catalogs | No, within their current response contracts; preserve source verification |
| AI prompts/providers, admission retrieval and source checks, task/history handling | Existing backend modules | No; do not expose provider credentials or change unrelated IELTS configuration |
| Membership eligibility, order confirmation, download quota enforcement | Existing authenticated backend services | No for existing rules; public config must never grant access or bypass payment |
| Admissions/IELTS teacher menu labels added after config v1 | Currently bundled native cards | Yes for these two labels until a versioned client capability is added |
| Room theme palette/particles and decorative place/moment fallback text | Currently bundled `scriptAtmosphere.js`/WXSS | Yes for those presentation fields; actual stage opening and image already come from the backend |
| Composer grid, keyboard behavior, gesture/camera/crop code, new pages or native APIs, privacy UI | Bundled native code/permissions | Yes; the backend cannot replace already-installed native code |

No claim that every UI label or layout is remotely configurable. The already-uploaded 1.0.92 composer correction still requires selecting/releasing that client version; this backend publication is independent.

## Publication preparation

1. Capture the active **public JSON** separately for release/trial/develop, including exact response bytes and SHA-256. Do not copy any private storage, environment or tokens.
2. Pin the deployed service schema and icon allowlist by hash. Use its validator before and after preparation.
3. Prepare with the existing script (all paths absolute):

   `node scripts/prepare-native-product-config.mjs --input <public-base.json> --output <new-publication.json> --schema <pinned-schema.mjs> --icons <packaged-icons.json> --revision <new-revision>`

4. The builder keeps Home, Coach, pages and category order from the chosen base. It synchronizes only supported Tavern public metadata from the canonical server registry. It never spreads private character cards or permissions.
5. Run `npm run test:native-product-config`, service schema tests and the exact frozen client validators/loaders for the oldest supported and current capability. Test network success, 304, invalid response, offline last-good and preserved private drafts.
6. Pass the target-specific production readiness/rollback gate. Use the existing service `publish.mjs` with the **exact expected-current revision**; publish develop first, accept it, then trial/release. Existing immutable publication bytes are the rollback target. Do not restart Node or Nginx for a content-only pointer change.
7. Verify public HTTPS bytes/revision/hash and conditional 304 on every changed channel, then the post-change gate. Reject concurrent drift rather than overwriting it.

### Compatibility regression fixed here

The newer client required a ninth persona but sent the same `capability=1` as eight-persona clients. The live eight-persona publication was rejected wholesale by newer clients. The new projection includes all nine personas and uses a **common packaged icon** for the horror role. Older clients treat that additional role as generic text chat; newer clients preserve its bundled story/image capabilities. No claim that a metadata update installs new native functionality in old clients.

Future client capability additions must not silently make previously optional fields required under an unchanged capability number. Test the actual active publication against the frozen client before every upload, and new publications against every supported capability before activation.

## References

The existing native component boundary is consistent with [official WeChat examples](https://github.com/wechat-miniprogram/miniprogram-demo). The project’s existing `client/docs/backend-driven-foundation.md` records its trusted-component/public-data design. No external runtime framework or dependency was added.
