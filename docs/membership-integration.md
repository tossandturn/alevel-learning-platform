# STEM membership integration

STEM consumes the shared IELTSist membership authority using protocol `stemist-membership-v1`. It does not create grants or trust client membership claims.

## Runtime boundary

- The public membership catalog and authenticated status/order routes proxy to the loopback identity authority through signed requests.
- Positive entitlement decisions may be cached for at most 30 seconds and never beyond the actual entitlement expiry. Negative/unknown decisions are not cached.
- Enforcement requires both STEM enforcement flags and defaults OFF. If STEM is ON while the identity authority is unavailable, malformed, or reports enforcement OFF, paid features fail closed with 503.
- Inactive authenticated users receive 403 `membership_required`; unauthenticated users receive 401.

When enforcement is ON, STEM practice, AI/Coach, marking, curriculum-practice question/source/create/submit routes, question-image, and protected file handlers check membership server-side before dispatch. Both short-lived bearer identity and the reviewed native session cookie are accepted. Account/profile, announcements, membership/order recovery, approved public catalogs, and owner-history read/delete paths remain accessible. Curriculum-practice exposes only its exact `GET /catalog` discovery route publicly; authenticated `GET /history` and `GET /sessions/:id` remain owner-scoped recovery routes and never return new question/source bytes.

The browser receives only `verified-practice-discovery-v1` route/topic/count metadata publicly. Full verified units, paper marking metadata, and route-scoped study indexes use protected API routes and private/no-store responses. Route fragments live under `server/data/study-question-index`; the public directory retains only the sanitized manifest. The Vite build fails if the answer catalog, full index, or server-only builders re-enter the browser dependency graph. Safe-off behavior retains the existing guest response contract.

Verified catalog and route-fragment publishers use same-directory atomic replacement. The server rechecks file identity in-process, returns byte-bound revisions/ETags, and existing browser builds use stable API schemas, so a backend data publication does not require a Mini Program or web-client rebuild.

## Activation blockers

Do not enable enforcement until the identity authority, backend release/data migration, and device flows are deployed together. A production migration must verify all 26 private route fragments and the public manifest, ensure Nginx/CDN cannot serve legacy route fragments or protected assets ahead of Node, and prove real Mini/browser PDF/image/index requests carry a valid cookie or bearer token. Previously public, cached, or exported bytes cannot be revoked and are not represented as DRM; new bundles and new requests must follow the protected boundary.

See the identity authority's `docs/membership-integration.md` for the order/provider/ledger contract. No merchant secret or payment parameter belongs in STEM code or client bundles.
