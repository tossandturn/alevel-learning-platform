# Coach completion and latency acceptance

## Reproduced defect

The provider sent a complete response and terminal SSE marker but kept its HTTP body open. The server continued reading until its deadline, incorrectly returning an interrupted answer. A loopback regression with an open keep-alive body reproduced this before the fix.

Provider completion now ends the read loop immediately, releases the reader and aborts remaining transport work in cleanup. The existing completion/finish-reason checks remain: truncated, malformed or unfinished answers cannot be promoted to complete. No provider credentials, models, academic reasoning setting or IELTS service configuration are changed.

## Validation scope

- Real-stream loopback test: terminal marker with an open connection, truncated finish reason, body cleanup.
- Coach jobs: lost acknowledgement, original-task recovery, owner isolation, quotas and restart handling.
- Related regression matrix: answers/hints, images, formula rendering, source identification, Tavern/media/draw/memory, admissions adviser, IELTS teacher and whole-paper marking/report lifecycle.
- Synthetic native-runtime probes use newly created QA identities and original test diagrams, not student images. Record preparation/upload/first-visible/end timings separately.
- A controlled non-thinking model comparison was faster but made a wrong arithmetic result on the graph fixture. It was rejected; the deployed academic reasoning setting is retained.

Client transfer work is scoped to STEM Coach: sub-megabyte image preparation and page-memory reuse on retry preserve the same request fingerprint. Other IELTS photo consumers retain their existing pipeline. Client and backend deployment evidence are separate; an uploaded development version is not proof that the user's experience version points to it.

## Final-sweep Tavern regression

A real synthetic draw follow-up failed, and the next native resume rejected an empty failed assistant row (`message.content` invalid). Native Tavern resume/message APIs now select completed nonempty pairs before pagination. Pending/failed rows remain in the store, retaining revision, lease and idempotent retry behavior; adviser recovery uses the unchanged default history view.

DeepSeek documents occasional empty JSON-mode content. Only an explicitly stopped, empty JSON response can receive one same-provider retry without the JSON constraint, within the original deadline and with identical trusted prompt/history. Refusals, truncation and HTTP failures are not retried by this rule; output still undergoes media allowlist/schema validation. Schema failures are now classified separately from transport failures. The local regressions cover resumed failed history, pagination through failed turns, a single recovery, completed replay and a second empty response stopping safely.

## References

- [DeepSeek request keep-alive documentation](https://api-docs.deepseek.com/quick_start/rate_limit/): transport activity is not answer completion.
- [Original DeepSeek streaming recipe](https://github.com/deepseek-ai/deepseek-recipe/blob/main/docs/streaming.md): streaming protocol reference; no implementation copied.
- [DeepSeek JSON output](https://api-docs.deepseek.com/guides/json_mode/): documented empty-content edge case and mandatory validation.
- [Microsoft long-running operation guidance](https://github.com/microsoft/api-guidelines/blob/a7022a299442a8352431874e63ec4dff548a1b81/azure/Guidelines.md#long-running-operations): preserve job identity across transport retries.
