# 《蓝色留到明天》实施计划与内容约定

> 用户在场景方案后明确要求立即实施。沿用逐本做完整的要求，本轮完成威尼斯一本，不同时铺开四本。
> Implementer: use TDD; preserve every existing content edition and active room.

## Goal

交付一部 1–2 人可玩的原创成年爱情本，三幕分别在威尼斯的临水修复画室、运河旧书店、屋顶小型晚宴。视觉、职业生活与线索来自这里，不使用候车室、广播室、末班车或离乡送别。旧六本及其存档保持不变。

## Story and interaction

- 许映，26 岁，纸本修复师；陆晞，28 岁，在威尼斯生活八年的装帧师、版画作者。两人为了书店的屋顶展览合作十一天，起初并不是恋人。
- 共同任务：找齐一本蓝色折页画册的配套档案，完成修复与展陈。当前展览、两人往日匿名创作交流、眼前正在生长的好感共同构成主线。
- 第一幕：合并纸本检测与装帧目录，唯一确定 B17 档案。公开曾被保留的读者批注与草稿，建立好奇和共同劳动。
- 第二幕：合并两人持有的交接记录，核实四封信件的前后顺序，揭开旧笔名与真实身份的联系。角色各自知道自己的过去，不能假装不知道自己做过的事，也不能预知另一人的秘密。
- 第三幕：不再填一个告白密码。两人分别公开自己的新计划，才解锁最终回应；共同决定展览如何收场，分别决定约会、慢慢相处或做搭档。
- 前两幕的个人选择进入 AI 可见的本人决定与最终回顾；恋爱结果须双方明确选择，不由公投、解谜分数或旧信替代。

## Technical scope

1. New server-only module `server/scriptVeniceRomance.js`, ID `venice-blue-hour`, edition `venice-blue-hour-20261107`, client capability v2.
2. Exact-edition hooks for sealed reveals, final-choice availability, AI partner routing, scoped actor memories and relationship outcomes. Existing campus and murder-case behavior remains unchanged.
3. Add catalog registration, two stable voices, authored scene entrances, and image manifest. No new client controls, dependencies, database migration or Mini Program upload.
4. Eight original 2D anime assets: 3 scene illustrations, 2 adult portraits, 2 object illustrations, 1 neutral cast illustration. No readable puzzle answers in art; future scene requests remain gated.

## Verification tasks

用户随后要求同时优化现有剧本。本轮追加表演层改进：保留角色事实与玩家全文，剥离 AI 上下文里的纯玩家操作指导；保留跨幕可见记录；在普通闲聊时不主动催推进。旧六本剧情与已保存消息不改写。每个旧本逐一验证两类对话，并记录真实模型验收，不以新本测试代替旧本测试。

- Add `scripts/test-script-venice-duet.mjs`, observe the missing catalog entry fail first.
- Verify exact edition, complete independent role books, unique puzzle solutions, first/second reveal once only, final reveal only after both current clues are public, own-role permissions, 9 final relationship combinations, solo both roles, two humans, restart and cross-act private memory.
- Verify current actor never receives the other private book, future clues or puzzle solutions; natural care, refusal, banter and already-explained facts in real AI acceptance.
- Run existing campus, room, scene, voice, art and secret-boundary regressions; compare old six-book hashes.
- Inspect every generated image; frozen native v1.0.92 checks at mobile/iPad if available. Record unavailable real-device coverage honestly.
- Before production: fresh read-only readiness and rollback verification; backend-only allowlist artifact; then authenticated journeys, image hashes, old-room continuity and both site health. Any failed/unknown mutation gate blocks deployment.

## Sources and originality

- [Ink original repository](https://github.com/inkle/ink), MIT: stateful scenes/choices pattern only, no new dependency or imported source.
- [Venice municipal visitor information: artisans](https://www.veneziaunica.it/en/sustainable-venice/detourism/venice-s-artisans): city texture; all characters, shops, artifacts and events here are fictional.
- [Venice Original artisans](https://www.veniceoriginal.it/en/artisans): restoration, gilding and book/art workshop texture.
- Previously researched two-person works inform information asymmetry and relationship consequences only. No borrowed characters, dialogue, puzzle, plot twist or proprietary art.
