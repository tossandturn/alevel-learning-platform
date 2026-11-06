# Stable character voice / remove director-language leakage

## Root cause and scope

The role cards contain explicit agency reminders in dialogue examples and authored entrances. These are delivered directly by `stageStart` / `requestEvidence` and also supplied to the model as examples. The model then imitates the coaching/rule language. The current prompt is mostly prohibitions, while personality differences are lightly specified. This is both a content-source and generation-quality issue, not a request to disable player agency or fact checks.

Backend-only: create a separately versioned voice layer for 18 script roles and 9 Tavern personas; keep pinned plot/identity/evidence/missions unchanged. Personality combines desire, social mask, vulnerability, speech rhythm, intimacy/anger responses and original dialogue examples. Gender presentation follows the existing fictional adults, never a universal male/female stereotype. Names shared between different stories remain separate identities.

Replace future authored NPC entrances and evidence handoffs with natural, stage-scoped lines; evidence cards remain exact. Add the voice profile every generation, replace old example/entrance style in the provider-only projection, distinguish backstage instructions from spoken lines, keep narration in third person. Do not rewrite stored player conversations.

For non-streaming script jobs, detect narrow director-language leaks and repeated contrast templates before persistence, using the existing single bounded repair opportunity. A normal denial or factual negation is valid: do not globally remove “不” or change testimony. Continued invalid output stays uncommitted. Ordinary Tavern keeps streaming and receives the same stable style instructions through the shared system prompt, without an additional per-turn model call.

## Acceptance

- TDD: all 27 voices, adult character/name mapping, concrete and distinct examples, stable phase behavior, normal negative sentences retained, prompt leakage caught, no evidence/secret/mission changes.
- Regression: existing room editions, romance consent, murder-case truth, actor/narrator separation, cross-act private memory, image delivery, Tavern state/streaming.
- Production readiness and rollback before backend deployment. Synthetic authenticated conversations cover female/male personalities, stress, intimacy, criticism, refusal and cross-act continuation. Review actual prose, not keyword counts alone.

## References and reuse boundaries

- [百变大侦探官方投稿说明 (2020-11-17)](https://www.taptap.cn/moment/15202017291011186?group_id=159848): independent per-role/per-act texts, player-perspective logic, believable behavior, connected relationships, clear tasks and readable pacing. Historical craft guidance, not a claim about current submission terms.
- [百变官方公开剧本推荐](https://www.taptap.cn/app/136635/topic?type=official): public descriptions show emotional relationships woven into playable investigation. No access to, copying or close rewriting of paid role books.
- [SillyTavern original character-design documentation](https://github.com/SillyTavern/SillyTavern-Docs/blob/main/Usage/Characters/characterdesign.md): personality/scenario/examples/character note separation; first-line style and examples influence delivery. Structural inspiration only; no external code or character card imported.
- [Ibsen, A Doll's House, original play text in Project Gutenberg](https://www.gutenberg.org/files/2542/2542-h/2542-h.htm): study shifts between a character's social performance and private intention, shorter replies under pressure, and conflict expressed through exchanges. No dialogue, plot, period gender hierarchy or character identity imported.

## Correction captured for this task

Rules about who controls a player are backstage constraints, not NPC small talk. Keep authority enforcement in the engine, but author what a person wants to say now. The correction is documented here rather than modifying the user's unrelated `.learnings/ERRORS.md` or cross-session memory.
