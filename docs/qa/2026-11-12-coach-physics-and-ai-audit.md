# Coach physics diagrams and AI regression audit

Date: 2026-11-12 (Windows host, Asia/Shanghai). This report covers local candidate code only; no deployment, client upload, real payment, production database access or physical-device acceptance was performed by this workstream.

## Delivered changes

1. `server/coachPhysicsDiagram.js`: bounded `stem-force-v1` semantic recipes become deterministic, canonical `stem-diagram-v1` primitives. Existing clients already support the output format. Weight stays vertically down; normal is perpendicular to the explicit contact surface; friction opposes the stated relative slip/tendency; axes rotate with the chosen surface. No automatic force, magnitude, equilibrium or unknown contact is inferred. Separate source/basis text is mandatory but is model-supplied, not independently verified.
2. `server/coachDiagram.js`: the existing nonstream/SSE sanitizer validates and compiles those recipes; incomplete, invalid and unfenced recipes do not leak raw JSON. Clients without diagram capability keep text only.
3. `server/coachPolicy.js`: use explanatory physics diagrams when helpful, especially free-body diagrams. Diagrams obey the same hint/exam restrictions; a force-diagram question in hint mode cannot be answered by drawing the complete requested answer. Unreadable or missing physical conditions are not filled with guesses. Ray paths, circuits, waves and graphs retain the existing generic bounded primitive schema, not a new scientific renderer for each topic.
4. Native client `utils/nativePractice.js`: one guard previously treated any access-token change during marking as logout. Same-account renewal now remains valid while the existing session owner/privacy-epoch check and token-presence check still reject actual account switch, privacy revocation and logout. No POST retry or duplicate scoring call was introduced. This fix requires a client update.
5. `scripts/test-admissions-advisor-api.mjs`: the screenshot fixture had a permanently fixed 2026-11-01 preview creation date. It had expired by this audit and correctly returned an excerpt card. The ready-preview fixture now starts its TTL at test execution; no production expiry policy was weakened.

## Test evidence

- Red: the new physics test failed before implementation with missing compiler module. Green: geometry, schema, unsafe/unsupported field rejection, missing contact/slip basis, horizontal/incline/free fall/tension/underside contact, canonicalization and all stream split positions passed.
- New HTTP integration: JSON, photographed-question SSE, old-client compatibility, invalid diagram text fallback, hint policy, durable job persistence, idempotency, restart recovery and active-exam rejection passed. Six calls used a synthetic local provider, not the live model.
- Native marking regression: 24 checks passed, including newly reproduced token-renewal failure and four deferred cases (renew / account switch / privacy epoch / logout).
- Broad regression runner executed **67 existing/new test programs, final 67 PASS**. First run was 66/67 due to the expired screenshot fixture above. The final run includes actual local HTTP handlers/SQLite fixtures, provider contract mocks, native page method execution, scoring failures, retry/restore and ownership boundaries. It is not equivalent to live-provider or complete real-user acceptance.
- Diagram compatibility: current native renderer and frozen 1.0.92 renderer each drew four generated force fixtures at widths 280, 327 and 700: **24 executions PASS**. No diagram client runtime change was needed.
- Fresh native WeChat simulator screenshots captured all four fixtures: incline, horizontal sliding block, free fall and suspended body. Inspected the narrow incline and horizontal figure: labels remain legible and axes/force directions match the intended fixture. Real phone/iPad/Pencil and OS accessibility settings remain NOT VERIFIED.

Artifacts outside Git, under the task workspace:

- `qa/physics-diagrams-20261112/renderer-results.json`
- `qa/physics-diagrams-20261112/native-results.json`
- `qa/physics-diagrams-20261112/native-incline.png` and three peer screenshots
- `qa/ai-regression-20261112/all-results.json` and per-program sanitized logs
- `ops/run-ai-regressions-20261112.mjs` (67-program bounded runner)

## AI entry matrix / actual call paths

| Entry | Actual implementation path | Local evidence | Still separate |
| --- | --- | --- | --- |
| Steps / answers / check work, text and photo | `runCoach` → `/api/ai/coach` or `/stream`, native durable jobs, image upload and recovery | Policy, language, image, stream, deadline/completion, task/job and ownership programs PASS | Exact live text + image provider, mainland transport and real photo legibility |
| Chapter written-answer submit | Native `pages/stem/practice.submit` → `markQuestion` → persist attempt → capabilities → `/api/ai/mark-handwriting` → validated per-part result | Native practice, verified handwriting API, marking client and result schema PASS; token-renewal defect fixed | Live verified QP/MS + photographed answer and same-account refresh on a device |
| Past-paper submit | `pages/stem/paper.submitPaper` → `runAutomaticGrading` → `runPaperAssessment` → `markPaperQuestion`/`markPaperChoice` | Automatic page submit invokes scoring; partial failure, self-assessment separation, pause/resume, no duplicate completed work, revision/ownership PASS | Whole real paper coverage and live-model marking consistency |
| MCQ chapter / paper | `gradeObjectiveAnswer` with verified answer source, not invented AI choice | Objective answer, native choice, component and AI-reviewed label contracts PASS | Per-paper source coverage; AI-reviewed topic keys do not become official full-paper grading |
| PDF whole-paper marking | Native upload/job controls → STEM marking job → `createWholePaperAiRunner` → validated report | Eight backend programs and native upload/report/storage-pressure programs PASS | Actual live vision provider, uploaded PDF job and generated result/report acceptance |
| IELTS Reading / Listening Coach | `runCoach` with `product=ieltsist` uses `askIeltsCoach`, not the STEM diagram route | Native Coach/context/writing/read-only contracts and teacher role boundaries PASS | IELTSist backend configured Coach provider + real passage/transcript on the separate service |
| IELTS Writing feedback | `ieltsWriting` → `/api/writing/feedback/start` then `/job/:id` on IELTSist | Native full-page writing, prompt/source guard and report contracts PASS | Real writing service job, photo input and band/report quality; not proved by STEM teacher tests |
| IELTS Speaking | Native microphone/PCM + short-lived direct realtime session; distinct from text teacher | Native speaking contract/state tests PASS | Actual recording, live voice provider, turn taking, output audio and automatic speaking-score service |
| IELTS teacher in Coach | `/api/ai/ielts-teacher/...` fixed server-owned teacher conversation | API, four-mode, teacher/recovery tests PASS | Live reading/listening explanation, short grammar edit, text-only speaking prompt |
| Admissions advisor | `/api/ai/admissions/...` research + source-preview + fixed conversation | Advisor API, research flow, current directory targets, preview ownership and native sources PASS | Current official query, fetch, source grounding, screenshot/fallback and provider response |
| Tavern / divination / story rooms | Server-owned personas, draw payloads, room rules + scoped actor dialogue | Tavern divination/memory, native presets/story formatting, room API/client PASS | Root's per-book independent critique and live role-play/image acceptance |

### Is all past-paper automatic scoring implemented?

Submission does trigger scoring on the native chapter/paper paths; this was verified by executing the actual page methods against their service boundaries, not merely locating test files. **It is not honest to say every downloadable paper can already be automatically scored.** A written question needs the verified QP/MS binding, canonical part marks and current marking capability. Missing source/part context or an unavailable model yields explicit pending/self-required state; unscored work is not silently zero and a partial report is not a whole-paper score. Automatic background continuation after leaving a page is also not implied: the native per-question flow pauses subsequent requests, while the separate PDF task workflow is durable.

## Live-provider handoff

`ops/live-ai-canary-20261112.mjs` has passed syntax validation, **not yet been run live by this workstream**. Root may run it only after the current exact-target readiness gate:

```
node live-ai-canary-20261112.mjs --execute-live --candidate-root <complete candidate> --runtime-root <current runtime> --scratch-root <dedicated existing scratch> --suites coach,teacher,admissions,wholepaper
```

The 11 bounded synthetic cases use runtime provider configuration in memory, require the expected Singapore Bailian Coach model/host, bind to loopback only, generate an isolated identity and store synthetic conversations only in their own temporary directory. They do not read a student database. Results are safe telemetry and synthetic-answer evidence; cleanup only removes that owned temporary directory. They cover candidate handlers against live providers, **not production HTTPS or physical-device acceptance**.

For handwriting against released QP/MS, the existing `scripts/qa-live-released-marking.mjs` is the narrow source-bound canary. It requires an independently verified source receipt/hash/cache/library context and `--execute-live`; never make up provenance to get a passing mark. For room dialogue, use the root's existing script rehearsal/acceptance harness. For IELTSist writing and realtime speaking, use the separate service's approved test identity and gate; STEM text-teacher success is not a substitute.

## Research and tool notes

- Checked [OpenStax free-body rules](https://openstax.org/books/university-physics-volume-1/pages/5-7-drawing-free-body-diagrams) and the [original PhET model overview](https://github.com/phetsims/forces-and-motion-basics/blob/main/doc/model.md) for basic physical interpretation/presentation. All code, figures, prompts and fixture questions here are original; no third-party text, illustrations or code was copied.
- Initial native test project used a tourist AppID rejected by the installed DevTools. Reused only the existing released public AppID/lib version in an isolated synthetic fixture, then opened successfully. First automator call timed out while the new project initialized; a route/fixture identity check then passed and four screenshots were captured. No user draft was modified.
- Windows `rg` does not expand shell globs in path arguments; use directory plus `-g` or exact observed paths. Several exploratory searches hit path/glob errors and were corrected; this did not mutate source or affect test results.
- No user-owned `.learnings/ERRORS.md` changes were touched.
