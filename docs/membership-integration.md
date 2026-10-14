# STEM membership integration

STEM consumes the shared IELTSist membership authority using protocol `stemist-membership-v1`. It does not create grants or trust client membership claims.

## Runtime boundary

- Public membership/catalog/status/order routes proxy to the loopback identity authority through signed requests.
- Positive entitlement decisions may be cached for at most 30 seconds and never beyond the actual entitlement expiry. Negative/unknown decisions are not cached.
- Enforcement requires both STEM enforcement flags and defaults OFF. If STEM is ON while the identity authority is unavailable, malformed, or reports enforcement OFF, paid features fail closed with 503.
- Inactive authenticated users receive 403 `membership_required`; unauthenticated users receive 401.

When enforcement is ON, STEM practice, AI/Coach, marking, curriculum-practice, question-image, and protected file handlers check membership server-side before dispatch. Both short-lived bearer identity and the reviewed native session cookie are accepted. Account/profile, announcements, membership/order recovery, approved public catalogs, and owner-history read/delete paths remain accessible.

Protected study indexes, question assets, curriculum/native images, and local PDFs use private/no-store responses while enforcement is ON. Safe-off behavior retains the existing response contract.

## Activation blockers

Do not enable enforcement until the identity authority and device flows are deployed together. The public bundle still embeds protected `verifiedPracticeCatalog` answer data, old client/cache copies cannot be revoked, and real Mini/browser PDF/image/index requests have not proved that they carry a valid cookie or bearer token. These are release blockers for a complete paywall even though the API gates are implemented.

See the identity authority's `docs/membership-integration.md` for the order/provider/ledger contract. No merchant secret or payment parameter belongs in STEM code or client bundles.
