# Further Coach latency evaluation

## Scope and outcome

The user asked whether Coach can be faster again. This pass measured the remaining latency and compared candidate behavior. **No production model setting, prompt, runtime or service was changed.** The answer-first and opt-in-source runtime remains deployed.

Read-only readiness before/after profiling passed. Tests used an isolated loopback instance of the deployed middleware, synthetic authentication and public/synthetic questions. No production user account, chat history or authentication key was accessed. Provider keys stayed inside the existing server loader. Only timing/token counts were collected for reasoning; reasoning text was neither retained nor displayed.

## Experiment

Eight problems: three public question photos (diver, polynomial, completing the square) and five typed checks (improper integral, circular-motion force, log domain, conditional probability, linear equation). Each used the same deployed answer/source-separation contract. Modes were current low reasoning, a test-only concise-format prompt, and test-only thinking disabled. Order alternated between problems. There was one sample per problem/mode; this is not a controlled broad accuracy benchmark or phone/network SLA.

| Mode | Mean first content | Mean complete answer | Complete-answer range |
| --- | ---: | ---: | ---: |
| Current low reasoning | 3.180 s | 4.408 s | 1.983–7.481 s |
| Concise-format candidate | 4.037 s | 5.288 s | 2.115–11.644 s |
| Thinking disabled | 0.788 s | 2.596 s | 1.649–3.622 s |

Provider response headers took approximately 0.15–0.46 s. For the diver photo, the current mode delivered first reasoning at 0.870 s and first answer content at 4.700 s; extra thinking accounted for most of that interval. This does not measure the user's phone-side image compression/upload time.

## Quality gate and decision

The fast circular-motion response initially asserted a normal force of **6.0 × 10³ N**, then correctly calculated **5,810 N** and gave **5.8 × 10³ N** at the end. The first asserted result is inconsistent with its later calculation. Current low reasoning correctly gave 5.81 × 10³ N from the start in this sample. An answer that is initially wrong cannot pass the default fast-mode gate just because its last paragraph is correct.

All 24 requests completed and preserved the source opt-in contract. Nevertheless, **thinking-disabled default: FAIL quality gate**. The concise-format candidate did not demonstrate a stable latency benefit and was not deployed either. The production default remains unchanged while the user considers the speed/quality tradeoff. No model/vendor switch or extra verification model call was silently introduced.

## References

- [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/) documents the thinking toggle and effort mapping; `low` is already the lowest thinking effort.
- [Official DeepSeek harness adapter](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek/README.md) documents per-request thinking control and stable streaming abort handling. No implementation or dependency copied.
- [DeepSeek context caching](https://api-docs.deepseek.com/guides/kv_cache/) describes automatic shared-prefix caching. The profile recorded cache-hit counts; it did not assume every request was a cache hit.

## Development package reconciliation

The earlier **1.0.59** upload is now officially **UPLOAD_VERIFIED**. Runtime commit: `e24529d887a94e5ff3da8d92765707499c4971a1`. Official compiled sizes: total 2,463,074 bytes; main 1,988,068 bytes. No duplicate upload, public review or public publication was performed. Physical-phone testing remains NOT VERIFIED.
