# AI regression and upstream stream repair

Scope: user-requested AI feature retest and repair; baseline `1c91750900ec84b8965087c9f08361bac1c3d708`. No model, region, thinking defaults, language policy, payments, schemas or content-readiness changes.

## Reproduced defects and fixes

1. The upstream reader parsed each `data:` line as JSON, although SSE permits a single event to contain multiple data lines. A valid multi-line JSON event failed with `AI_RESPONSE_SCHEMA_INVALID`. The bounded incremental decoder now frames complete events across CR/LF/CRLF and UTF-8 chunks; heartbeat/comment fields are ignored.
2. Responses-compatible streams appended finalized text snapshots to already streamed text, duplicating the answer. They also treated arbitrary `delta` events as answer text, including reasoning/tool events. Only `response.output_text.delta/done` now contribute text, with per-content-part snapshot reconciliation. Reasoning is progress-only. Nested final-response payloads are understood; incomplete/conflicting snapshots fail closed.
3. The prior language-policy change added a second `pretest` property and inadvertently shadowed the original release checks. The hooks are merged into one entry, retaining all existing checks plus language/framing tests, with a guard against recurrence.

No extra model request, automatic paid retry, increased timeout or new dependency is introduced. Runtime deployment is limited to `server/aiApi.js` and `server/aiSse.js` after readiness, code backup and exact hash checks.

## Verification contract

- Tests first reproduced multi-line framing failure, duplicate final text, reasoning-to-answer leakage and duplicate test-hook configuration.
- Cover named events, all chunk boundaries, UTF-8, CR-only streams, bounded frames, snapshots with and without deltas, multiple content parts, malformed JSON, truncated outputs and completed-but-incomplete envelopes.
- Re-run academic/Tavern/admissions/IELTS/PDF regressions; real deployed-provider isolated journeys cover lost acknowledgement, blank photo, high-mode saved tasks, two-turn context, source-backed admissions and mark-point reconciliation.
- Native simulator acceptance remains blocked while developer-tool login is expired; do not equate automated client tests with a physical phone test.

## Primary references

- [WHATWG SSE framing](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)
- [DeepSeek keep-alive contract](https://api-docs.deepseek.com/quick_start/rate_limit/)
- [OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)
- [Microsoft original Fetch Event Source](https://github.com/Azure/fetch-event-source/blob/main/README.md), MIT: design reference only. No code copied or package installed.
