# Admissions advisor — isolated fifth Coach feature

Adds a text-first international-undergraduate application advisor without changing IELTS, academic answers/source lookup, PDF marking, Tavern personas or provider credentials.

## Contract

- Fixed server-owned AI identity; planning, qualitative profile analysis, truthful document coaching and application emails.
- Explicit separation between user-provided information, assumptions, advice and facts requiring official verification. No live browsing tool is claimed; user-provided URLs, quotes and dates are not treated as verified official evidence.
- Signed STEM owner authentication and existing authorization-hook invocation. This inherits detailed Coach's current login policy. The current no-attempt hook does not discover global exam status or subscription entitlements; injected denial tests are hook-contract coverage, not a claim that global membership enforcement exists.
- Independent admissions SQLite root, allowed persona and conversation namespace. Existing Tavern stores retain their original defaults and schema path; generated-result receipt and pending-delete protections are opt-in for admissions only.
- `/api/ai/admissions/conversations/resume`, owner-bound message pagination, explicit deletion and `/api/ai/admissions/stream` (`meta`, `delta`, `done`). No arbitrary client history, persona, system prompt, image or study context is accepted.
- Maximum 12,000 Unicode code points, CRLF normalization, secret/image-data redaction, bounded provider deadline, canonical user/assistant turn pairs.
- Durable generated-result receipts allow commit recovery without another model call. If all durable storage fails, the result is explicitly indeterminate and not automatically retryable; an unconditional exactly-once promise is not made.
- Pending generation cannot be deleted as if already gone; the client gets an explicit retryable state. Failure after SSE headers stays an SSE failure, not JSON written over an open stream.

## Verification and release boundary

Focused tests: `npm run test:admissions-advisor`. Regressions include existing Coach answer/source/stream, four modes, Tavern long-memory APIs, provider routing and deadlines. Tests use synthetic identities, temporary stores and mock providers unless an acceptance receipt explicitly says real provider.

Deployment is a separate phase, requiring a fresh strict shared-server gate, pinned three-file artifact, verified rollback, unchanged IELTS services and live acceptance. No production build, database migration, provider configuration change or public Mini Program publication is implied by this document. Final deployment/upload status is recorded in the acceptance receipt, not inferred from tests.

### Verified release receipt

Runtime `a1a5d265032f2ad6c7c2ed05bffaf38fac6123c9` was deployed as a pinned three-file overlay. Before/after upload, activation, restart and isolated live acceptance gates all passed. Swap remained 9.28%; free disk approximately 7.67 GiB; IELTS process identity/restart count stayed unchanged. Existing database data, environment, provider settings and Nginx configuration were not changed. Rollback code hashes were verified.

Final focused API suite: PASS (12 synthetic provider calls, 35 authorization-hook checks). Independent review repeated the expired-lease/receipt-recovery adversarial probe; no outstanding P1/P2 findings. The receipt flags and new receipt table are enabled only in the isolated admissions store.

Real configured-provider acceptance used temporary synthetic identity/history with deployed middleware on loopback. Planning completed in 4.607 seconds and its contextual email follow-up in 4.451 seconds. Canonical history, same-turn replay without a new generation and synthetic deletion passed. These are small server-side samples, not physical-device latency or a broad admissions-accuracy benchmark. Public HTTPS unsigned resume returns 401. Local evidence is under `D:/CodexWork/admissions-advisor-20261027/`.

## References

- [UCAS AI/personal-statement guidance](https://www.ucas.com/applying/applying-to-university/writing-your-personal-statement/a-guide-to-using-ai-and-chatgpt-with-your-personal-statement): authenticity, permitted planning/checking support and destination-specific rules.
- [LibreChat agent architecture reference](https://github.com/LibreChat-AI/docs/blob/main/content/docs/features/agents.mdx): role and conversation isolation; no external implementation or dependencies copied.
