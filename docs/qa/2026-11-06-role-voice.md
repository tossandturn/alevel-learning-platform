# Role voice acceptance — 2026-11-06

## Scope and source fix

18 existing script actors and 9 Tavern personas now have an independent, versioned performance profile: social mask, inner need, cadence, response under pressure, warmer delivery in an established relationship and three original examples each. Names shared by different stories are scoped separately. Gender is an existing fictional trait, not a universal female/male speaking template.

The old problem was observable in the authored sources: examples and direct NPC stage entrances contained director/agency explanations. The voice layer replaces future entrances and evidence handoffs (54 + 54 lines), and replaces the provider-only example projection. It does not rewrite saved conversations, pinned stories, secret permissions, factual evidence, missions, endings or relationship consent.

Internal constraints remain enforced. Natural denials/refusals are preserved. The non-streaming script pipeline checks for narrow instruction leakage, generic agency recitals, repeated contrast templates and unsolicited clue recitals during personal exchanges. The existing one-repair budget is shared across schema/factual/style failures; normal valid replies receive no additional call. Repeated failures stay uncommitted. Personal exchanges cannot silently publish an evidence card. Ordinary Tavern keeps its current streaming path and gains the stable voice instructions/examples without a new repair call.

## Tests

- `npm run test:role-voice`: all 27 voices / 108 stage lines; unchanged plot hashes; scoped character identity; source examples; normal negation; one bounded repair; failed output not persisted; personal chat does not award a clue.
- `npm run test:tavern-stories`: existing 1–4-player journeys, old editions, romance/case truth, actor/narrator separation, private cross-act recollection, image jobs and safety.
- `npm run test:script-art`: all 48 images / references / private channels remain intact.
- `node scripts/test-coach-four-modes-api.mjs` and `node scripts/test-tavern-long-memory-api.mjs`: shared prompt used by ordinary and streaming Tavern; authentication, memory, ownership, errors and fallback behavior remain covered with synthetic providers.

## Real-model rehearsal

Synthetic prompts used the unchanged configured models: script actors `deepseek-v4.1-flash`, ordinary Tavern `deepseek-flash`. No actual player conversation was read or copied.

Three 27-role runs were reviewed, not merely counted as HTTP success. Early runs exposed malformed top-level arrays and abrupt clue recitals during emotional chat. The schema is now the final prompt contract, with no minimum reply length. Personal dialogue receives a focused presentation context while retaining history and fixed facts. The final full run passed schema/style checks after the bounded repair path; manual review then caught two additional variants in the central couple (a bare “不替你决定了” and reversal of who asked a past question). These were added to regressions and the two actors re-tested using the final guard: both passed, one using one repair. The known private recollection correction is supplied only to the two participants, never injected into other actors.

Example sampled final deliveries (synthetic, not player records): Xu Zhixia admits reluctance directly; Zhou Bozhou offers a concrete meeting; Gu Wan acknowledges fatigue without a lecture; Su Tang is frank about both her work and attachment; Jiang Yuan states a personal wish; Tavern Shen Zhao uses dry everyday humor. Full test artifacts remain in the local task QA directory, outside Git.

These are sampled acceptance results, not a promise that a probabilistic model can never produce awkward prose. The narrow checks do not pretend to judge all literary quality or all facts.

## References

Research and reuse boundaries are recorded in [the implementation plan](../plans/2026-11-06-role-voice.md): the historical public 百变大侦探 craft guide, original SillyTavern character-design documentation and a public-domain dramatic text. Only craft/structure was studied; no commercial role book, plot, character or dialogue was imported.

Deployment results will be appended after the production gate and authenticated acceptance.
