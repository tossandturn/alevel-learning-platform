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

## Production acceptance

Backend release `a8990b26fc30df9ff58ec6576ba071e4880a8b04` deployed on 2026-11-06 (Asia/Shanghai), five allowlisted server modules only. Before/install/post gates PASS; verified code rollback retained. No provider/settings/database migration, Mini Program upload, or IELTS restart. Both products' loopback/public health endpoints remain HTTP 200.

Authenticated production acceptance PASS:

- One existing synthetic room retained its exact conversation, role, clue, mission, relationship and phase-state hash after activation.
- Six real script replies across the four-person and two-person romance books used the new pipeline; narrow style checks passed on delivered text. Entrances/evidence transitions stayed valid.
- A private proposal's time/place was recalled after changing acts; the other human participant did not receive it. This verifies both memory continuity and private-channel isolation.
- Three real Tavern replies (two regular JSON and one SSE stream) continued naturally even with an old rules-style reply in their synthetic history.
- Frozen 1.0.92 client presentation: 45 view states still pass with unchanged client files and artwork.
- Test accounts left their synthetic rooms; no real player conversation was inspected or edited.

This is backend/API/model acceptance, not a new physical phone test.

## 人格差异速览

| 角色 | 稳定性格与弱点 | 对话感觉 |
| --- | --- | --- |
| 许知夏 | 克制、敏感，在乎却怕显得还在等 | 话轻，认真时直接追问；愿意承认舍不得 |
| 顾晚 | 利落、习惯安排事情，自己的需要总往后放 | 简短明确；被认真关心时会有一点笨拙 |
| 苏棠 | 坦率、有锋芒，着急时容易把商量说成通知 | 先讲自己的想法，心软也说得直白 |
| 周泊舟 | 实际、慢热，解释自己时不如做事利索 | 少空泛承诺，更多具体想做的事 |
| 林序 | 机敏、爱逗人，认真时容易拿玩笑挡一下 | 轻快，有自嘲；关键处收住玩笑 |
| 江远 | 温和、内敛，习惯先说没事再藏住失落 | 慢半拍，逐渐把自己的愿望说清楚 |

其余角色同样拥有独立的行为与口吻设定，完整版本在 `server/roleVoices.js`。这不是统一的“女声模板／男声模板”，也不是给每人固定一句口头禅。旧聊天原文保留，新回复使用新的人格表达层。
