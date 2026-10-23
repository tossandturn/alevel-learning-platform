# AI Coach question provenance

> **For implementer:** Use TDD. Write failing source and stream-contract tests before implementation.

**Goal:** Append an evidence-backed exam origin after academic answers, including CAIE subject, year, session, paper variant and question number; never invent a source.

**Architecture:** A bounded server-side resolver reads the existing eligible question bank and authoritative attempt binding. Typed question text uses conservative literal matching. For photos, the existing vision answer may include a short private transcription trailer; the server strips it from JSON and streaming output, matches it, and appends its own source text. No second model/OCR call, no new external search or upload, and no provider/IELTS/Tavern change. Existing clients render the ordinary Markdown source subsection.

**Tech Stack:** Existing Node ESM Coach HTTP/SSE routes and native answer renderer. No dependencies, new database or client route.

## Tasks

1. Add `scripts/test-coach-question-source.mjs`. Cover canonical CIE metadata, exact/subquestion text, duplicate origins, short generic questions, changed numerical values, forged context/source, quarantined/unreleased items, metadata limits and split/truncated hidden trailers. Confirm RED.
2. Implement `server/coachQuestionSource.js`: conservative normalization, bounded cached eligible index, immutable/public source metadata, trusted-attempt lookup and source formatting. Untested/ambiguous origins remain explicitly unconfirmed.
3. Add API tests for both JSON and SSE: append source only to successful academic results, strip private trailer across every chunk boundary, preserve leading answer/step streaming and completed terminal event, preserve failed/partial behavior, reject spoofed source fields, keep Tavern and exam protection unchanged.
4. Integrate into `server/aiApi.js` and the academic prompt without changing model settings or request deadlines. Only image requests without an existing reliable match request a short transcription trailer. The provider continues to receive the original image.
5. Verify the existing native formatter renders `题目出处` and the paper code without losing formulas or answers. Test real canonical text and a public source image, plus unrelated-question and unclear/ambiguous cases. Record limits: text match is not a guarantee of image identity; no universal coverage claim.
6. Run relevant backend Coach/provider/Tavern tests, client Coach/rendering tests, syntax, diff and secret checks. Prefer a backend-only release after fresh resource/source/rollback checks. No production build, question-data edit, public unreviewed release or IELTS mutation.

GitHub references: [LlamaIndex citation query engine](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/query_engine/citation_query_engine.py) and [LangChain document metadata](https://github.com/langchain-ai/langchain/blob/master/libs/core/langchain_core/documents/base.py). Reuse the principle that citations are tied to retrieved records, not generated from model memory; no library installation or copied implementation.
