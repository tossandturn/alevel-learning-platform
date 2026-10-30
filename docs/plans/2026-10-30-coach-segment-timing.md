# AI Coach segmented latency

Scope: academic photo answers and diagnostics for admissions text; no IELTS configuration, payment, model, reasoning-effort or question-bank changes.

1. Add bounded, numeric-only monotonic provider timings: request serialization, headers, first substantive chunk, first visible answer, semantic completion, output duration and token/cache counts when reported. Heartbeats/empty frames are not an answer; never collect reasoning text.
2. Join these timings to the existing durable academic job result, including body receipt, validation, preparation and completion. No database migration or new personal-data retention.
3. Measure native image preparation, POST acknowledgement, first displayed answer, polling and complete response independently. Do not subtract clocks on different machines or describe provider network/queue time as measured model reasoning.
4. Run the same synthetic graph, multi-part calculus and short-answer fixtures before/after. Change only demonstrated bottlenecks, preserve full educational correctness, math rendering, cancellation/reconnect and idempotency.
5. Run source and native regressions; deploy an exact allowlist after before/after readiness gates. Any client release gets a new version, never changes the uploaded 1.0.74 artifact.

References (patterns only; no third-party code copied, no dependency added):
- OpenTelemetry GenAI client inference (Apache-2.0): https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/client-inference.md
- DeepSeek streaming content vs reasoning: https://api-docs.deepseek.com/guides/thinking_mode/
- DeepSeek cache usage fields: https://api-docs.deepseek.com/guides/kv_cache/

Acceptance: timings contain no prompt/image/user identity/credentials; old clients still work; failed/partial/replayed requests are distinguishable; measured speed claims include sample size and correctness checks, not a blanket latency guarantee.
