# Coach language policy — 2026-11-03

Approved scope: the user's latest request replaces the 2026-10-31 always-bilingual policy.

- Ordinary Coach chat, Tavern, admissions, IELTS teacher, work checking and marking: follow the current student's requested/conversation language. Keep requested English drafts, examples and evidence intact; no automatic full translation.
- Only academic complete-answer and step-hint modes automatically use Chinese/English for word problems or explanatory questions. Determine the task from actual text/image evidence, not just the surrounding message. A complete English explanation is required; a hint remains one bounded hint, never a leaked solution.
- Pure calculation/symbolic subquestions do not trigger translation. Mixed questions apply the exception only to relevant parts. Preserve formulae, diagrams, source truth, exam limits and response schemas.
- Existing bilingual history is context, not the current output policy. No extra classifier or translation model call.

Plan: failing policy/API tests; replace shared policy and conflicting role instructions; verify local and real-provider fixtures; deploy only allowlisted backend files after readiness/rollback checks. No client release, schema, credentials, provider, payment or quota change.

Reference check: original DeepSeek repository issue reports discuss response-language drift (https://github.com/deepseek-ai/DeepSeek-V3/issues/1443). This is user-reported evidence, not a provider guarantee or a reusable implementation. No third-party code copied or dependency installed. Regression coverage uses existing project contracts.
