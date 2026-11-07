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
- Authenticated production journeys, real AI dialogue quality and before/after server readiness: PENDING until recorded below. No claim of zero future model errors.

## Source references

See `docs/plans/2026-11-07-venice-duet.md`. Reference methods only; the story, characters, dialogue, puzzles and images are original. No third-party script text imported.
