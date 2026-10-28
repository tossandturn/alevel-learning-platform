# Free paper download quota

User-confirmed contract: each authenticated free account may download two different hosted paper/answer PDFs per Asia/Shanghai calendar day, across CIE/AP/IB. QP and MS count separately unless they are byte-identical. Same-day retry/Range/resume of the same SHA256 does not consume again. Opening a verified complete local cache does not request the server or consume. Active members are unlimited.

## Implementation boundary

- Start from the published STEM 9b268410 and Mini Program 1.0.63/e6ccfb0 baselines. Do not merge the incomplete Apple IAP candidate or broad membership paywall.
- Store the durable quota ledger in STEM's existing database; read actual membership from the existing signed identity entitlements endpoint. No identity database or payment change is needed.
- Treat verified SHA256 as the resource key, not URL, filename, request count or QP/MS pairing. Serialize new grants with BEGIN IMMEDIATE and re-read the clock after locking.
- Validate catalog rights, file existence/integrity and Range before granting a new file. HEAD/304/404/409/416 do not consume. An authorized transfer occupies one file grant even if the network later fails, preserving unlimited same-day retry for that file.
- Existing grants continue to support resume if membership authority is temporarily unavailable. New-file authority failures must not silently downgrade members or permit unlimited free access.
- Gate both actual byte exits: /local-pdf and /api/stem/curriculum-papers/files. Verify Nginx/CDN routing cannot bypass the application before activation. Official external source attribution is not a hosted download and this is not DRM.
- Mini Program credentials may only be sent to exact trusted STEM PDF origins/paths. Preserve owner/privacy isolation and complete-cache-first behavior. Quota errors retain partial checkpoints and show reset/login guidance; never auto-open payment.
- A new client download header capability is required. Do not enable server restrictions for all users before the compatible client is available and rollback is verified.

## Test-first sequence

1. Pure ledger: 2 unique free files; same SHA idempotence; different users; unlimited/expired membership; Beijing midnight; atomic multi-connection races; restart persistence.
2. Authority bridge: signed loopback only, canonical owner, real active/expiry rather than global features.allowed, timeout/malformed response fail closed, no secret output.
3. Actual CIE/AP/IB routes: valid GET/206 consume once; metadata/invalid files/ranges no charge; auth and JSON errors; cross-route shared budget.
4. Client: headers only to trusted files, no header/token in cache keys/storage, quota/auth errors do not erase resume data, cache hit performs zero network, cancellation/account change suppress late work.
5. Full relevant regressions, original-native QA, package budget, source hash check, independent review. Deployment is a separate gated step with exact live-source reconciliation, resource preflight, rollback and public-domain acceptance.

## References

- https://github.com/animir/node-rate-limiter-flexible — atomic storage/counter patterns only; do not use its first-request-relative window for a Beijing calendar-day quota.
- https://github.com/nodejs/node/blob/main/doc/api/sqlite.md — SQLite transaction and prepared-statement API reference. Use the project's installed Node-compatible API; no dependency install is required.
