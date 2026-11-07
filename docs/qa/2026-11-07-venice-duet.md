# Venice duet and existing-script performance QA

Date: 2026-11-07 (Asia/Shanghai). Production status below must not be inferred from local tests.

## Delivered scope

- Original two-adult Venice story `venice-blue-hour`, exact content edition `venice-blue-hour-20261107`; three locations, two fair cooperative puzzles, third-act sharing rather than a third password quiz.
- Two complete private background books, staged chapters and individual choices; nine relationship-choice combinations, public closing vote independent of romance consent.
- Eight reviewed original anime images: 3 environments, 2 fixed adult portraits, 2 objects, 1 neutral cast image. 1,906,730 bytes total WebP. Raw originals and prompt ledger retained outside repository under task `art/venice-20261107` and `qa/venice-20261107`.
- Existing scripts: pure player-instruction sections removed only from actor-context projection; complete player books and story facts unchanged. Personal dialogue no longer carries the current mission-choice label as a command. Explicit public progression questions route to deterministic, current-state host guidance. Puzzle hints and memory concerns remain normal dialogue.
- No dependency, database, payment, auth, client source or unrelated study-content change.

## Local verification — PASS

- `npm run test:script-rooms`: existing case, duet, memory, role-book, 1–4-player, access, idempotency, narrator/actor and API regressions.
- `npm run test:script-venice`: both solo perspectives, all 9 two-human relationship outcomes, unique puzzle solutions, reveal-once, final sharing gate, restart, role privacy, durable private appointment and no public leakage.
- All six existing current game definitions retain exact pre-change SHA-256 hashes.
- `npm run test:script-campus`, `npm run test:script-scenes` (207 cast/scene configurations), `npm run test:role-voice` (31 voices), `npm run test:script-art` (64 total assets with integrity and stage gates).
- `node ../ops/qa-venice-frozen.mjs`: 34 views with the unmodified native client 1.0.92 / 83b8d9f, both roles, all acts and endings. Dynamic images and locked choices render through the existing protocol.
- Native isolated fixture at 390×844: inspected opening image/dialogue, full private identity reading and final three-option decision panel. Initial simulator navigation landed at the home page; explicitly navigating the identified synthetic fixture recovered the inspection. No real account fixture or upload used.

## Boundaries / not yet verified

- Existing neutral native theme is used. A new named native theme, scene navigation label or transition would require a client release and is not claimed.
- Physical phone, iPad and Apple Pencil were not exercised in this turn.
- No claim of zero future model errors; behavior was sampled through the real-provider and authenticated production checks below.

## Real-provider rehearsal — PASS

- Isolated candidate runtime using the configured Singapore `deepseek-v4.1-flash`, thinking enabled with low effort, same provider operation as script rooms.
- Two complete Venice solo journeys, six existing current scripts, 16 completed model replies (22 provider calls including bounded repairs), 14 current-state host checks with **zero model calls**.
- Both Venice roles retained the private meeting location across scenes, recognized the disclosed identities, and accepted/refused romance without cancelling an ordinary meeting.
- Read actual responses for the six existing scripts: personal care was answered as dialogue, not a repeated evidence checklist. This is sampled behavioral evidence, not a guarantee that all possible dialogue is defect-free.
- Transcript: task `qa/venice-20261107/rehearsal.json` (synthetic fiction only).

## Deployment health — PASS

- Runtime commit `9503b729d61ab4d50554a7537768e1d6757f6342`, 19 allowlisted runtime/media files; no production build or dependency installation.
- Read-only readiness passed before installation, after file installation and after the one STEM restart. Exact eight-file rollback archive verified; eleven newly added files recorded for rollback removal.
- Post gate at 2026-11-07 23:53 Asia/Shanghai: memory available 63%, disk 77%, swap 8.64%, three I/O-wait samples 0%; services/containers stable; both local and public STEM/IELTS health HTTP 200. All nineteen deployed file hashes matched.
- Direct and existing-proxy SSH transports were intermittently unavailable. No firewall/proxy/global SSH configuration was changed; failed checks blocked the next mutation until a fresh complete gate passed. IELTS restart count remained unchanged.

## Authenticated production acceptance — PASS

- Two solo Venice perspectives and one two-human journey completed all three acts and the ending through the public HTTPS API with short-lived, server-generated synthetic-account authentication. No credentials were printed or stored.
- Wrong-answer handling, repeated request idempotency, final-plan sharing before relationship choices, one-human advance not moving both, mixed relationship intent and closing-vote ties all verified.
- Twelve completed real AI replies: six new-book continuity/relationship probes and one personal-care probe in each of the six existing scripts. Public operational questions correctly used the host. Read the actual replies, not only job status.
- The pre-update synthetic old room had the same complete state hash after restart and successfully advanced. Existing canon stayed pinned. Test rooms were left/closed; no real student room was changed.
- All eight new image URLs returned HTTP 200 with `image/webp`, and bytes matched the release SHA-256 manifest.
- Final post-acceptance gate at 2026-11-07 23:58 Asia/Shanghai: PASS, memory available 62.56%, disk 77%, swap 8.64%, I/O-wait samples 1/0/0%; both local/public sites healthy, all 19 file hashes matched, verified rollback retained. STEM had exactly one restart; IELTS had none.
- Scoped lint had no errors; warnings remain for existing control-character patterns/unused projection bindings and one intentional discarded `actorDecision` binding in the new projection. No broad formatting or unrelated fixes were applied.
- Detailed synthetic evidence: task `qa/venice-20261107/production-acceptance.json`. Delivered runtime commit remains `9503b729d61ab4d50554a7537768e1d6757f6342`; later QA-only commits do not imply another server restart.

## Source references

See `docs/plans/2026-11-07-venice-duet.md`. Reference methods only; the story, characters, dialogue, puzzles and images are original. No third-party script text imported.
