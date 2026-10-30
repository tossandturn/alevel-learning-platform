# Student-selected Coach thinking effort

The student may choose `low`, `high`, or `max`; the owner confirmed **low as default**. This is a request setting, not an arbitrary provider/model/key control or a change to authorization, exam-help limits, marks or membership.

`coachEffort.js` validates the exact optional enum and creates a request-local DeepSeek configuration. Omitted fields retain legacy behavior, request hashes, deadlines and fallbacks. An explicit choice enables thinking with the selected level and does not silently fall back to an incompatible model. Raw reasoning is never sent as the student answer.

Academic JSON/SSE and recoverable jobs, Tavern (including draw interpretation), admissions and IELTS teacher all bind the selected value into their request. Stateful replay hashes distinguish levels and preserve old missing-field hashes. Long-thinking requests retain an internal bounded lease long enough to finish. Per-request maximum output is 8192 / 16384 / 32768 tokens, with high/max generation deadlines bounded to 90/115 seconds total. Unselected legacy output limits are unchanged. Client foreground recovery includes upload and result-delivery allowance; retries do not generate a second turn or change the captured setting.

Whole-paper creation accepts the optional enum and stores it in a nullable `reasoning_effort` column. Migration is additive and repeat-safe; historical null records are not reinterpreted. Creation idempotency includes an explicit level, and upload, worker execution, retry and owned history use the same stored value. The scoring validator and source/ownership rules are unchanged. The independent IELTS service's writing, voice and model configuration are outside this release.

Verification includes enum/unsupported-provider rejection, actual JSON and SSE body fields, hidden-reasoning non-disclosure, old-client omission, immutable provider config, replay conflicts, long request lease, additive migration, real worker metadata flow and client pending/draft isolation. Test and native/production evidence is recorded separately; local green tests alone are not a release claim.

Deployment requires exact baseline hashes, a private SQLite backup outside served roots, resource and active-AI-work gates, and a code-only rollback that leaves the nullable column in place. Never restore an old DB over new student writes merely to roll back this feature. Deploy only the allowlisted STEM modules; do not replace shared runtime wiring or touch IELTS/payments/quota configuration.

References: [official API model capabilities](https://api-docs.deepseek.com/api/list-models/), [official thinking mode](https://api-docs.deepseek.com/guides/thinking_mode), [DeepSeek's original provider selector guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md). These were implementation references only; no external implementation or asset was copied or installed.
