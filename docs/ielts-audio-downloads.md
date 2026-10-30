# Listening MP3 export gateway

The user confirmed on 2026-10-31: managed audio exports and paper/answer PDFs share **two different files per signed-in free account per Beijing day**. Ordinary listening playback remains unmetered. Same-day same-hash ranges/retries reuse a grant; members use the authoritative current entitlement. Verified complete account-bound export caches need no new grant. Existing unpaid playback buffers are not export caches.

## Contract

- `GET /api/stem/ielts-audio`: public, versioned catalogue; optional `book`/`taskId` filters. Registered source task, original book/Test numbering, track, descriptive MP3 filename, size and SHA only; no filesystem path or private account data.
- `GET|HEAD /api/stem/ielts-audio/files/audio-<32hex>`: closed catalogue lookup, always authenticated/quota-enforced, independent of old-route compatibility flags. Content-addressed immutable MP3s under the STEM-owned `data/ielts-audio-downloads/current` pointer. Size, MP3 signature and SHA checked before grant.
- `HEAD`, `304`, invalid `416`, and stale `If-Match` `412` do not consume. Valid first GET/range uses the same existing `pdf_download_grants` table as PDFs. No new database schema.
- Audio and PDF denial retain `pdf_daily_limit_reached`/`X-Pdf-*` for compatibility; student copy now identifies the shared audio/PDF allowance.
- New client PDF requests send `X-Stemist-Download-Policy: shared-files-v1` on exact trusted gateway paths. The marker only opts into stricter checks: it never supplies an identity, membership or a larger allowance. Unmarked old routes retain the existing rollout flags; no global quota/payment/config switch is changed by this feature. Header-aware responses vary by the marker and authorization.

## Registered content

Read-only source inspection found 72 existing listening tasks and 288 MP3 files, 2,246,049,878 bytes. No transcoding or question/scoring changes. Cambridge12 keeps original Test5–8 with practice Test1–4 separately labelled. Copies, hashes, staged pointer activation and rollback are tracked in the task deployment receipts; source inspection alone is not installation proof.

## Verification / boundaries

`npm run test:ielts-audio-downloads` and `npm run test:pdf-download-quota` cover mixed allowance, exact opt-in/auth, Range/resume, source boundaries/corruption, stale validators, membership, concurrent grants and Beijing midnight. Native client/frozen/production acceptance and deployment status are recorded separately.

Do not expose arbitrary upstream URL/path download parameters, copy student files or alter original IELTS playback assets, speaking/writing models, membership payments, or old global rollout flags. A development upload does not prove public-client availability or physical file-sharing acceptance.
