# Separate duet and cross-act continuity — 2026-11-06

## Scope and design

- Add original fifth script `one-more-stop` / 《再陪我一站》; exactly two adult roles, one or two humans, AI fills the other seat for solo play. Three acts, two evidence items per act, private personal choices, consent-aware endings. Existing four catalog entries and content snapshots remain hash-identical.
- Recover exact older dialogue excerpts from the already persisted room transcript. Apply public/private visibility **before** retrieval. Label speaker, act, source and truncation; bound anchors to 12 / 6,000 characters. Keep current/past known evidence and the actor's own completed choices.
- New messages record stage; committed AI replies record trigger linkage. Old snapshots infer stages only from server-authored act openings. No destructive migration, no new retention policy, no old-room reset.
- Opening unknown-state is not permanent ignorance. Actual session disclosures update current knowledge; distinguish current-game “earlier” from pre-game history. Unanswered proposals do not become agreements; corrections supersede old plans.

Research references (architecture only, no copied story text): [ink stateful narrative](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md), [SillyTavern character design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/).

## Local verification

- RED observed: private promise outside the last 35 messages was absent from context; separate fifth-script assertion failed before implementation; client role-count binding assertion failed before copy fix.
- PASS: backend `npm run test:tavern-stories`, including old 1–4-human journeys, 16 original-romance outcome combinations, duet 1/2-human journeys, all four duet final-choice combinations, third-player rejection, no public/other-pair private-memory leak, restart and legacy metadata recovery, latest correction, known-evidence priority and bounded excerpts.
- PASS: client `npm run test:all`; catalog count text now comes from the selected script. This source change is **not uploaded** in this backend-only task.
- Full real-device and production acceptance recorded below after execution; local tests alone do not prove production delivery.

## Limitations

- The model still generates prose; no claim of universal semantic verification or zero hallucinations. Retrieved excerpts are bounded, not every line of an arbitrarily long conversation. Existing room lifetime/limits remain unchanged.
- New duet reuses existing authorized rain-station illustrations. It does not have newly generated dedicated art. Frozen 1.0.92 uses its neutral unknown-script theme and server scene images; its fixed “four stories / four roles” text cannot be altered by a backend patch. Corrected client copy awaits a later consolidated release.
- User-supplied private screenshots/transcripts are not copied into fixtures or Git. Tests use synthetic dialogue and authored story facts.

## Local debugging lesson

Long-term continuity must include **both speakers** and the provenance/time of acquired knowledge. Retaining only an NPC's own recent answers does not establish what it has been told. Privacy filtering belongs before retrieval, not in a prose disclaimer after retrieval. Windows `rg` patterns must use `-g` rather than a literal wildcard path.

## Production

- First backend release `30cbe0c` activated after exact-file/resource gates and verified rollback. Three scene-image GETs, five-book public catalog, old-room continuity after restart, and authenticated 1/2-human duet journeys passed. No student rooms or purchases were test targets.
- Live old-room probes recovered an older private meeting location/object outside the recent window and correctly recognized the paper-bag plan as learned tonight, not eight years ago. Public follow-up retained public evidence without the private promise. Replies completed in about 5.1 / 5.1 seconds.
- Manual review of a 3.1-second duet reply found an invented literal past utterance, despite correct high-level history. Added a narrow quote-provenance check: quoted past utterances must appear in authored facts or visible dialogue (style examples excluded). One bounded repair is permitted; repeated unsupported output is not saved. RED was observed, then the full Tavern suite passed. This is not a semantic verifier for unquoted prose.
- Source `cbaef69` fixes client numeric copy; **no client upload**. Frozen 1.0.92 passed both roles, two seats, full role books, private channels and 2-clue adoption. Its generic neutral theme is retained for the new script.
- Final runtime `d9a7a72` deployed with a second two-file verified rollback. Post-change readiness PASS: about 63% memory available, swap 8.64%, filesystem 77%, three I/O-wait samples 0/1/0%, no build/backup job; internal and public health endpoints returned 200. Reserved IELTS process and restart counter unchanged. Initial immediate check during the first service restart briefly returned 502; subsequent startup and stable gates returned 200. This was not a zero-downtime deployment.
- Final authenticated production replay PASS: 47-message pre-deployment synthetic room survived restart, crossed into Act 2, recovered its private promise, retained newly learned public evidence, and did not repeat the private promise publicly. Replies took about 4.1 / 4.1 seconds; duet narrative probe about 5.1 seconds. The latter used an authored shared experience without an invented quoted utterance.
- Both 1-human+AI and 2-human duet runs completed all three acts; third-player joining rejected, two-item clue gates worked, and a non-mutual final decision did not produce a mutual relationship. Synthetic testers left their rooms after testing. No purchases, student accounts or real student rooms were mutated.
- Deployment and local regressions PASS. Real-phone replay of the user's particular room remains NOT VERIFIED; its existing transcript is preserved, not retrospectively rewritten. This report does not claim every possible generated recollection is fact-checked.
