# Student-facing STEM DeepSeek routing

Scope approved 2026-10-20: STEM step help, worked answers, image questions and whole-paper marking. **All IELTS functionality is excluded**, including spoken conversation, writing, reading, listening and AI help. Background question-bank/OCR/double-model verification is also not migrated.

## Contract and isolation

- `providerConfig` remains the original generic/background provider resolver.
- `studentProviderConfig` overlays an explicit academic provider only in `createAiApi` and `createWholePaperAiRunner`.
- The separate Tavern resolver continues to use its own configuration and disables thinking. If Tavern has no dedicated configuration, its legacy provider is preserved independently of the academic overlay.
- STEM uses official `deepseek-flash`, inline image input and thinking enabled with `reasoning_effort: low`. Administrators can explicitly select `high` in private academic settings. Client-supplied provider/model/thinking fields cannot change this policy.
- The whole-paper path requests supported JSON mode for DeepSeek. Existing page preparation, question/mark-scheme evidence, score reconciliation, failure retention and report-generation gates remain unchanged.
- No SDK dependency, database migration, frontend modification, public control endpoint, shared environment overwrite or client upload is introduced.

## Private settings

The opt-in settings file is the service user's `.config/stemist/academic-provider.json`, or the explicit `STEM_ACADEMIC_PROVIDER_SETTINGS` path:

```json
{"schemaVersion":"stem-academic-provider.v1","provider":"deepseek","model":"deepseek-flash","apiKeyFile":"deepseek.key","reasoningEffort":"low"}
```

The existing adjacent owner-private DeepSeek key is reused, not copied or modified. The bounded file reader rejects symlinks, hardlinks and unsafe POSIX ownership/permissions. Wrong or incomplete explicit configuration fails closed; an absent/disabled configuration preserves the legacy route.

For isolated tests or managed environments, `STEM_ACADEMIC_PROVIDER=deepseek` and `STEM_ACADEMIC_DEEPSEEK_API_KEY` configure only this student route. `STEM_ACADEMIC_PROVIDER=legacy` is an explicit rollback override. Never put a credential in source or a client package.

## Verification

- Test-first failure observed for the missing student-only provider resolver, then green route/wire tests for text, image, SSE, marking JSON, thinking enabled, Tavern thinking disabled, private settings, generic-route isolation and sanitized failures.
- Existing whole-paper AI/API/recovery/progress/report/artifact suites and Coach four-mode/answer-policy/Responses/stream contracts passed.
- Real provider synthetic tests: stationary-point coordinates and nature; conditional probability; scientific notation and units; velocity-time diagram areas; printed mathematical image recognition; reference-backed marking and no-reference/no-score policy.
- The controlled paper has a method-correct/answer-wrong first response and a correct derivative second response. Deterministic expected total is 3/4; both direct AI runner and the isolated complete job flow matched it.
- The local job produced a readable one-page Chinese PDF report. An initial local failure was diagnosed as missing Windows CJK font configuration; configuring the installed local font fixed the harness without changing production report code.
- Actual production/native acceptance is recorded separately. These short printed synthetic examples do not certify every handwritten answer, long paper, board or peak-load latency.

Evidence directory: `D:/CodexWork/stem-deepseek-20261020/`. Official references checked 2026-10-20: [vision](https://api-docs.deepseek.com/guides/vision/), [thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/), [original protocol reference](https://github.com/deepseek-ai/deepseek-recipe). No third-party implementation copied.
