# Tavern-only DeepSeek route

User authorized switching the recreational Tavern to DeepSeek on 2026-10-20, after isolated latency comparison. This change does not switch academic Coach, image questions, PDF marking or IELTS.

## Behavior

- Tavern regular and streaming routes use official `deepseek-flash` when the dedicated route is enabled, with `thinking: {type: disabled}`. Other features retain their existing provider chain and settings.
- The current media-capable Mini Program keeps its existing request/response protocol. Its regular reply uses JSON object mode and the server-validated catalog; legacy text-only clients remain compatible.
- Provider failure keeps the existing retryable state and original input. It does not silently send Tavern history to the known failing shared gateway or another provider.
- Previous conversations, media descriptors and idempotent replay are retained. No schema migration or history deletion. The current documented 1M context window is registered; retrieval and outbound bounds still apply.
- `/api/ai/status` adds only `tavernEnabled`, `tavernProvider`, `tavernModel`. It exposes no key, file content or private config path.

## Private runtime configuration

The default is the legacy shared route if no dedicated configuration exists. A generic DeepSeek environment credential alone does not enable routing.

Use either dedicated environment variables (`STEM_TAVERN_PROVIDER=deepseek`, `STEM_TAVERN_DEEPSEEK_API_KEY`), or an owner-private runtime file at the service user's `.config/stemist/tavern-provider.json`. `STEM_TAVERN_PROVIDER_SETTINGS` can point to another administrator-controlled settings file. Its non-secret schema fields are:

```json
{"schemaVersion":"stem-tavern-provider.v1","provider":"deepseek","model":"deepseek-flash","apiKeyFile":"deepseek.key"}
```

The key file must be beside the settings file. Both must be bounded regular files, not symlinks or hardlinked files, owned by the service user with owner-only POSIX permissions. The provider endpoint is fixed to the official HTTPS origin. Invalid explicit settings fail closed only for Tavern.

The production key is provisioned from the already configured local environment over encrypted SSH stdin, never in command arguments, source archives, application logs, local artifacts or client code. Existing secret/environment files remain untouched.

Rollback can restore the original two code files and leave the new key secured outside the application. Setting `enabled: false` in this private settings file or selecting `STEM_TAVERN_PROVIDER=legacy` returns the new loader to the prior route after a normal service restart.

## Verification

- Test-first failure observed: Tavern previously returned the shared `openai` provider despite dedicated settings.
- `npm run test:tavern-deepseek`: route isolation, client override rejection, thinking flag, JSON media, replay/history, failed retry without duplicate turns, stream route, previous-model history, private settings and file-safety guards.
- Existing Tavern media/HTTP, long memory/HTTP, divination/HTTP, Coach four modes, answer policy and stream protocol regressions.
- Live deployment and measured latency must be recorded separately; synthetic provider tests are not production acceptance.

References: [DeepSeek API](https://api-docs.deepseek.com/), [thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/), [model context and JSON support](https://api-docs.deepseek.com/quick_start/pricing/), [original DeepSeek adapter](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/llm/llm-deepseek). Current provider facts checked 2026-10-20; no external implementation copied.
