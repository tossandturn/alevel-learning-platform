# Admissions Public Research

Admissions uses the fixed official DeepSeek Search and Fetch APIs:

- `POST https://api.deepseek.com/v1/tools/search`
- `POST https://api.deepseek.com/v1/tools/fetch`

Protocol: https://api-docs.deepseek.com/guides/search/
Original implementation reference (no code/dependency copied): https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/web/web-deepseek-api

## Configuration

The independent loader defaults to the fixed protected official credential
`~/.config/stemist/deepseek.key`, read through `readPrivateProviderText` with a
512-byte bound and existing owner/mode/no-symlink checks. It never loads a
Bailian provider descriptor or a Bailian credential file. It does not change
the academic chat/vision model or any membership/download quota.

`STEM_ADMISSIONS_RESEARCH_PROVIDER=off` disables research. `deepseek` selects
the official API explicitly; no other provider selection is accepted.
An explicitly supplied `STEM_ADMISSIONS_DEEPSEEK_API_KEY` is supported. With
explicit `deepseek` selection only, the documented official academic env key
or a `DEEPSEEK_API_KEY` whose configured base is official may also be used.
No custom Search/Fetch endpoint or redirect is accepted. No credential values
belong in commands, reports, logs, fixtures, or source control.

## Request And Evidence

Search queries contain only public institution/course names, an optional target
entry year, the requirement category, and a reviewed official domain. They never
contain the original student question, name, email, grades, essay, or full history.
Recent owned user turns supply missing public scope; assistant guesses do not.
Pure edits and general school-selection planning do not search unnecessarily.
A target year is optional: the answer reports the retrieved page year separately.
General undergraduate policy also does not require a major. Official institution
policy pages may be retained when a course is already known, labelled
`institution-requirements` with `courseOfferVerified: false`. Specific course
pages must still match the requested course. The absence of a published AP exam
count is reported only as `not_published_in_source`, never as an inference that
AP is not required.
For named directions, a small institution-bound mapping also accepts Oxford
Engineering Science or Cambridge Engineering for Mechanical Engineering, and
Imperial Computing for Computer Science, only when the fetched body confirms
the relationship. `programmeMapping` records the actual application programme;
later specialisation is stated only with supporting progression evidence. A
title-only alias or unrelated course/another institution remains rejected.

The local directory establishes official domains and institution aliases only;
matching that directory is not a successful search. Actual Search results are
read through Fetch, with bounded public-URL/DNS checks before dispatch. The
direct HTTP reader additionally validates each redirect and pins DNS addresses.
Every research turn shares a bounded request deadline and reserves time for the
answer. Error statuses, empty results, missing course thresholds and ambiguous
years remain explicit; they never become invented official facts.

Course identity, grades/subject conditions and applicable years come from the
retrieved body, not search metadata. Numeric evidence takes precedence over
navigation headings. Source IDs are unique to the turn. Evidence is supplied in
a separate server-owned system message as untrusted page data. Output citations
and URLs on researched turns are checked against that turn's sources before answer delivery. Pure edits preserve original user links and normal incremental streaming. Research
metadata and the source appendix persist with the canonical result for replay.

## Events And Smoke

Actual Search/Fetch emits SSE `meta` with `mode: ai`,
`providerStatus: researching`, `researchPhase: search|fetch`, and the existing
conversation binding. The subsequent provider meta uses `connecting` and includes
the research outcome. Pure drafts and completed replay do not emit fake research
progress. Cited answer text is delivered after citation validation. Required scope
clarification uses a real model completion, preserving legacy clients' success
protocol. Search failure remains unavailable/retryable.

Read-only smoke, on the approved candidate checkout as the service user:

```text
npm run smoke:admissions-research
npm run smoke:admissions-research -- --current
npm run smoke:admissions-research -- --mit-general
node scripts/smoke-admissions-research.mjs --direct-course
```

The first two exercise official Search and Fetch for a fixed public Imperial
Mechanical Engineering query, respectively with and without a target year.
`--mit-general` probes MIT institution-level undergraduate/AP policy without a
major or target year. The direct-course command reads a fixed Sheffield
Mechanical Engineering course page directly.
They never call a model, read student records, mutate application state, or print
keys, provider bodies, or student text. Output contains status/code, public course
URLs/domains, body evidence flags/hash, page years, phases and elapsed time.
Exit 0 means the fixed probe obtained adequate evidence; a MIT general-policy
probe may explicitly report a partial/unconfirmed entry year while succeeding
on applicable institution policy. Exit 2 is blocked or
incomplete. This does not verify production chat, device behavior or deployment.
