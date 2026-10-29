# Tavern personality repair — 2026-10-30

## Scope and evidence

The current eight role IDs, owner-isolated conversation storage, recovery, drawings and media contracts stay unchanged. Fix the thin character definitions and compulsory conversational formulas, not the academic Coach, IELTS, payment or model routing. Existing trial client 1.0.73 can use backend prompt changes.

Inspection found a short direction paragraph per role, no character-specific dialogue examples, an exactly-one-question rule in the detective, and a repeated conditional sentence pattern for oracle roles. Synthetic live baseline: the banter role reacted to a rainy weekend then pivoted to another question; the tarot role offered indoor-activity advice despite a request only to vent. These observations are examples, not a population-wide measurement.

## Design

- Eight original, server-owned character cards: identity, preferences and flaws, voice, setting, conversational boundaries and three short examples. Preserve category titles/IDs; internal character names provide stable identity without impersonating a real person.
- Shared conversational rules: answer the latest utterance directly; offer a specific opinion/reaction when useful; no mandatory advice or closing question; follow user corrections and topic changes. Chat remains leisure, not tutoring.
- Separate examples from real memory. Continue recorded facts and scenes; never promote sample facts or invented user actions into history. Existing records are context, not a style template that forces old robotic phrasing.
- Tarot/hexagram readings use the existing authoritative draw. Ordinary follow-ups do not redraw or re-lecture. Entertainment boundaries remain, without repeating disclaimers every turn.
- Tavern-only sampling at 0.8, with thinking still disabled, bounded output/deadline and original provider. Academic sampling/configuration stays identical. This is an empirical setting to evaluate, not a promise of personality quality.
- Do not import user-supplied cards, jailbreak prompts, external assets or new dependencies. Media IDs stay allowlisted.

## References and reuse decision

- [SillyTavern character design](https://github.com/SillyTavern/SillyTavern-Docs/blob/main/Usage/Characters/characterdesign.md): separate stable character description, scenario and dialogue examples. [Engine license](https://github.com/SillyTavern/SillyTavern/blob/release/LICENSE) is AGPL-3.0; no engine code, bundled character text or artwork copied.
- [Character Card V2 specification](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md): reference the separation of identity/personality/scenario/examples only. The LICENSE URL did not resolve; do not import implementation, text or claim format compatibility.
- [a16z companion-app](https://github.com/a16z-infra/companion-app): reference combining character background with recent dialogue and retrieved memory; [MIT license](https://github.com/a16z-infra/companion-app/blob/main/LICENSE). No stack or dependencies imported. Existing private history store is retained.

All Chinese character biographies and sample dialogue in this patch are original. No real user conversation was used for QA or copied into a prompt.

## Verification and release plan

1. Failing card/anti-formula tests plus JSON and SSE route isolation assertions.
2. Implement bounded prompt assembly; remove only conflicting old wording.
3. Run relevant Coach/Tavern regression suites, inspect actual multi-turn synthetic DeepSeek replies across eight roles, including memory correction, topic change, user agency and exact draw recall.
4. Review diff, secret scan, commit/push exact files. Fresh readiness + exact production hashes + verified rollback before allowlisted STEM-only deployment. No production build or schema migration.
5. Verify native client send/history/media/draw against deployed backend with an isolated synthetic account, restore local storage, and report physical-device/subjective limits honestly.
