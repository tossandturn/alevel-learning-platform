# STEM academic DeepSeek implementation plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** Switch student-facing STEM text help, image questions and whole-paper AI grading to DeepSeek while leaving every IELTS feature and the background question-bank validation pipeline unchanged.

**Architecture:** Add an opt-in student-provider configuration, separate from the existing generic provider configuration and the already deployed recreational Tavern configuration. STEM academic requests use DeepSeek Flash with thinking enabled and a bounded effort; Tavern remains non-thinking. The existing score validation, exam restrictions, report jobs and client API contracts remain canonical.

**Tech Stack:** Existing Node ESM/fetch, native Mini Program HTTP, existing whole-paper renderer and job service. No client release, new dependencies or production build.

User scope clarification: IELTS is excluded in full, including writing, reading, listening, speaking and AI help. Do not modify/restart the IELTS app, its secrets, database, frontend or realtime pipeline.

## 1. RED and route isolation

- Create `scripts/test-stem-deepseek.mjs`.
- Assert STEM answer/photo requests use DeepSeek with thinking enabled, whole-paper marking uses the same dedicated vision provider, and generic `providerConfig` remains unchanged.
- Assert Tavern remains non-thinking and its prior history/replay contract is unchanged.
- Run `node scripts/test-stem-deepseek.mjs`; observe the expected missing-route failure.

## 2. Minimal implementation

- Add `server/stemAcademicProvider.js`, reading only dedicated environment settings or an owner-private `academic-provider.json`.
- Export the existing bounded private-file reader from `server/tavernProvider.js`; retain its behavior and tests.
- In `server/aiApi.js`, add `studentProviderConfig`, use it only for the student API, preserve the independent Tavern/legacy configuration, and serialize DeepSeek's correct thinking/effort fields.
- In `server/wholePaperAi.js`, use the student provider and supported JSON mode for DeepSeek only. Do not weaken schema/score reconciliation.
- Private runtime settings reuse the already secured DeepSeek key; no secret is copied or changed.

## 3. Verification

- Run new and existing Coach, whole-paper, media, Tavern and auth regressions.
- Test the real adapter on synthetic mathematics/physics text and images with exact expected results; visually inspect generated fixtures.
- Run an actual sample paper through upload, queue, marking and PDF report retrieval, including arithmetic reconciliation and progress.
- Keep unverified handwriting/long-paper/physical-device quality explicit; do not turn synthetic tests into a universal accuracy claim.

## 4. Delivery and unchanged IELTS gate

- Commit/push source and package only allowlisted runtime files from that commit.
- Fresh server readiness + exact old hashes + verified rollback before each mutation. No remote build.
- Add only the private academic settings file; never touch existing credential values, Tavern settings or IELTS configuration.
- Restart only `alevel-physics`; require unchanged IELTS PID/restart count and HTTPS health, active Tavern DeepSeek, new STEM DeepSeek status, actual native acceptance and rollback coverage.

References checked 2026-10-20: [official vision API](https://api-docs.deepseek.com/guides/vision/), [thinking control](https://api-docs.deepseek.com/guides/thinking_mode/), [original protocol implementation](https://github.com/deepseek-ai/deepseek-recipe). No external source copied.
