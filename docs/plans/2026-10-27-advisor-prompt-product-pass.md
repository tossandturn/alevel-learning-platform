# Advisor prompt product pass

## Scope

Optimize the two existing server-owned personas, admissions advisor and IELTS teacher, as useful student-facing products. Backend-only prompt changes; keep APIs, storage, owners, role IDs, provider configuration, deadlines, frontend, real-time IELTS and payment policy unchanged. Do not require another native upload for prompt-only updates.

## Observed product gaps

- Existing prompts emphasize restrictions more than a useful response workflow.
- They lack explicit treatment of profile corrections, existing context, direct draft/edit requests and repeated clarification.
- Teacher has no clear coaching versus mock-practice distinction; punctuation alone does not enforce one information request.
- A mandatory question at every ending can derail short grammar or document requests.
- Missing source material should limit unsupported scoring, not block useful partial corrections or solving from sufficient passage evidence.
- Long fixed templates and machine-like placeholders are poor on a phone.

## Desired behavior

Shared: answer the current request first, use already-known facts, latest user correction supersedes old facts, ask only material missing information, no routine questionnaire or repetitive disclaimers. Be concise by default, honor requested deliverable length, use brief mobile-friendly sections only when useful, no wide tables/raw JSON/code blocks for prose. Distinguish user facts, assumptions and advice without narrating internal policy.

Admissions: a practical non-sales-driven advisor. Separate eligibility, fit and next actions; distinguish achieved/predicted grades, requirements versus optional competitions/research. For document/email requests produce a usable fact-grounded draft or targeted edit first, with concise change reasons and human-readable placeholders. Never fabricate experiences or guarantee offers. School/program/year requirements remain unverified without actual verified evidence; one nearby source qualifier rather than repeated disclaimers. No unnecessary collection of sensitive identity/financial documents.

IELTS: adapt among planning, Writing, Reading/Listening and Speaking. Planning respects the time budget and includes an immediate task/checkpoint. Writing gives evidence-linked high-priority changes, correction and reason, or full revised text when explicitly requested; missing prompt/chart bounds scoring but does not block grammar help. Reading/listening use supplied evidence, derive answers when passage/question suffice without demanding an answer key; distinguish False from Not Given. Speaking defaults to coaching, switches to mock practice when requested, one information request per turn, no disguised multi-question sentences, no topic/Part jump on fragments, no correction during mock until asked/end. Part 2 one cue card; Part 3 links to Part 2. Text cannot assess pronunciation, pace or full Speaking band. Short completed tasks need no forced follow-up question.

## Implementation and acceptance

1. Tests first: focused prompt-contract tests plus a committed synthetic multi-turn scenario catalog. Preserve all current truthfulness/auth/receipt tests; update only obsolete wording assertions with stronger semantic checks.
2. Edit only the two prompt builder bodies plus safe version constants if useful; target <= 8,500 Unicode characters per prompt, no extra model pass or new dependency.
3. Run both API/adversarial suites and relevant provider/stream regressions. Independent review checks usefulness as well as boundaries.
4. Before/after comparison of selected synthetic conversations using current configured model in isolated loopback. Retain every actual response before evaluating. Do not accept keyword-only tests as behavioral proof. Include direct editing, changed profile, missing evidence, clarification, short answers, source claims and no fabricated experience.
5. Pinned two-file backend overlay, strict fresh readiness/rollback gates before and after mutation. Verify public routing and deployed hashes. No real user data, no frontend re-upload, no official release action.

## References and attribution

- https://github.com/langchain-ai/openevals — MIT; use scenario-specific/multi-turn evaluation ideas only, no code or dependency imported and no external trace upload.
- https://www.ucas.com/applying/applying-to-university/writing-your-personal-statement/a-guide-to-using-ai-and-chatgpt-with-your-personal-statement — preserve real student facts and authorship when assisting drafting.
- https://ielts.org/take-a-test/preparation-resources/writing-test-resources — task-specific evidence and criteria.
- https://ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-speaking — Parts 1–3 and audio-dependent assessment boundaries.
