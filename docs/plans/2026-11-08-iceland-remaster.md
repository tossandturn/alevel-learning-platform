# White-night greenhouse remaster Implementation Plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** Replace the repetitive station setting of newly created `one-more-stop` rooms with a complete Iceland greenhouse romance, while preserving every existing room's exact old edition.

**Architecture:** Internal version 3 / client capability 2, explicit edition `duet-iceland-20261108`. New rooms use an original three-act story; old version 2 resolves to the existing frozen definition. Art, authored scene exchanges and model context are edition-aware. The existing clue/puzzle/decision/advance/vote engine remains authoritative.

**Tech Stack:** Node ESM, SQLite room snapshots, existing JSON AI interface, versioned WebP media; no dependency, client, payment, authentication or schema changes.

## Creative contract

- New title: 《白夜还亮着》, remaster of 《再陪我一站》. Su Tang / Jiang Yuan retain their adult identities, occupations and three-year relationship; the old station is only a past memory.
- Present: a fictional artist residency in Hveragerði, Iceland, near the June solstice. Twenty-one days together making a light-and-sound installation; tomorrow she starts a six-month tour and he returns to a six-month domestic sound-restoration project. Extensions and relationship arrangements remain undecided.
- Act I, glass greenhouse: combine a lighting cue sheet with a recording index to synchronize three scenes (`BAC`). The location affects the task: bright summer nights make an indoor leaf-shadow installation a better choice than waiting for outdoor darkness.
- Act II, listening workshop: compare editing instructions and take records to identify the unprocessed complete recording (`R2`). An omitted intimate sentence was not rejection: its author had requested that private conversations stay out of public soundtracks. Original audio is represented by accessible textual records; no real audio is required or played.
- Act III, white-night courtyard: hand over the finished work, eat together, and separately choose whether to try the coming six months. The work can succeed even when the relationship does not continue. No tragedy, dangerous geothermal action, coerced reconciliation or invented shared promise.
- Warm original anime style: sage, pale peach, cool blue daylight, cedar and volcanic stone. Three distinctly composed scenes, consistent adult portraits, neutral props and ensemble; no visual puzzle answers.

## Reference evidence and limits

Accessed 2026-11-08. These are design references, not licensed story adaptations; no character, prose, art, puzzle or plot is copied. “Universally acclaimed” is not asserted.

- [Star Crossed, 2019 Diana Jones Award](https://www.dianajonesaward.org/the-2019-award/) and [publisher](https://bullypulpitgames.com/products/star-crossed): two-player romance tension and meaningful independent outcomes. This is a tabletop RPG, not a Chinese fixed-script murder mystery.
- [What Remains of Edith Finch, BAFTA 2018 Best Game](https://www.bafta.org/media-centre/press-releases/winners-announced-for-the-british-academy-games-awards-in-2018/) and [original developer](https://www.giantsparrow.com/games/finch/): use physical places and objects to reveal lived experience rather than delivering biography as a lecture. The application here is our design inference, not a claim of equivalence.
- [Return of the Obra Dinn, original creator and awards](https://obradinn.com/): consistent spatial evidence, player reconstruction and a finite truth. It is a mystery video game, not a duet romance.
- [inkle/ink](https://github.com/inkle/ink), MIT: explicitly tracked story choices and rejoining flow. Existing engine already fits; no new runtime or copied source needed.
- [Visit Iceland: summer daylight](https://www.visiticeland.com/article/iceland-in-the-summer/), [geothermal everyday life](https://www.visiticeland.com/article/how-does-iceland-use-geothermal-energy-everyday/), [Visit Hveragerði: geothermal park](https://www.visithveragerdi.is/service-page/the-geothermal-park): geothermal greenhouse setting and bright June nights. The residency, commission, characters and events are fictional; no claim of an actual public venue open at midnight. No aurora, polar winter darkness or exact perpetual sunshine claim for southern Iceland.
- [百变大侦探 official information collection](https://www.taptap.cn/app/136635/strategy/collection/2) contains its annual player-vote awards. Full commercial scripts were not read; no unverified “全网第一/零差评” claims are used.

## Implementation / verification steps

1. Add `scripts/test-script-iceland.mjs`; assert new/old edition routing, old definition hash, three distinct settings, full role books, original puzzle uniqueness. Run and observe the missing-edition assertion fail.
2. Add `server/scriptIcelandRomance.js`; update exact routing and public catalog in `server/scriptGameCatalog.js`; extend duet-only helper recognition without editing the old frozen book.
3. Add edition-aware scene performances, context, illustration selection and reference filtering. Test that both old and new art requests stay in their own edition, and future scenes remain inaccessible.
4. Generate and inspect eight original anime assets using the built-in image tool. Keep raw files and prompts outside Git; commit content-hashed WebP and reviewed manifest only.
5. Test both solo roles and two-human play across all acts, wrong answers, all four relationship combinations, capacity, privacy, private cross-act promises, replay/idempotency, frozen client rendering and old-room continuation. Run all script / role-voice / art regressions.
6. Rehearse real AI answers against the exact Singapore provider using synthetic isolated state; inspect natural speech and location continuity, not only HTTP status.
7. Build a local pinned allowlisted artifact, run a fresh server read-only readiness/rollback gate, deploy only this backend/media scope, rerun post-change gate and authenticated complete journeys. Preserve IELTS service and user rooms. If any mandatory gate fails, do not mutate production.
8. Record current evidence, remaining real-device limitations and rollout status. Do not claim every existing script has been relocated in this one-book release.

## Subsequent location work (not part of this release)

Audit the remaining station-overlap books one by one. Keep the theatre, planetarium, campus and Venice entries distinct; choose new geography only when character professions, clues and concrete actions need it. Never transplant a location name onto unchanged station dialogue.
