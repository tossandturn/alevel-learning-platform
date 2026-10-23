# AI Coach question source — 2026-10-23

## Student behavior

A completed academic answer receives a server-owned `题目出处` subsection. A canonical example is:

> CAIE International AS & A Level 物理 · 2024 年 2–3月 · 9702/22 · 第 2 题

The filename is also shown. Image-derived text matches are labelled as such and ask the student to check the visible question/numbers. Unknown and ambiguous matches are explicitly unconfirmed; they do not imply the question is original or absent from all past papers.

This first source adapter handles **CIE/CAIE source records**. Other boards, unindexed papers, translations, generic short prompts, incomplete diagrams and unreadable images are not assigned guessed Cambridge identifiers. Existing source/release eligibility is not relaxed and no question-bank data is changed.

## Trust and performance

- Official source metadata comes from the server's eligible question bank, not provider memory, an image filename, client context labels or earlier assistant messages.
- Server-authorized paper/question bindings are matched against that same source record and route. Standalone client paper IDs are not sufficient.
- Typed questions and the visible image transcription require long literal agreement. A substantial contiguous visible part can omit a leading introductory/figure-reference sentence; a changed numerical value does not match. Multiple source identities abstain.
- The existing visual model receives the original image. Its short optional transcription trailer is only an untrusted retrieval hint; it is removed across chunk boundaries before JSON/SSE output. No second model/OCR request or internet search is introduced.
- Source text is added only after a completed academic answer. Provider failure, partial output, active-exam protection, auth and Tavern behavior stay separate. No private source query or guessed provider source footer is shown to the student.
- A bounded index is cached for 30 seconds, capped by record count and total text size. No student's query/photo is persisted by the resolver.
- The unchanged native answer renderer already displays the source subsection; no client runtime/package increase is necessary.

## Verification

PASS: 15 focused backend suites covering both Coach HTTP/SSE paths, source matching, every trailer split boundary, changed numbers, duplicate origins, quarantine/unreleased/unsupported records, forged context, provider outages, timeout budgets, paper access, Tavern divination/memory and provider routing. Existing assertions were updated only where the new source footer or streaming whitespace boundary intentionally changes the response; terminal answer text and authorization assertions remain enforced.

PASS: current client Coach service/failure/image flow, academic math/answer modules, and targeted package parity. A real configured DeepSeek text answer completed in 3.68 seconds. A real official-paper image response completed in 8.87 seconds; its captured literal transcription was replayed through the corrected visible-part matcher and mapped to the expected 2024 9702/22 Q2. These are individual QA measurements, not a guaranteed response time or device-network benchmark. An earlier image probe failed and is not counted as passing evidence.

PASS: unchanged native components show the real-provider answer, source and filename; changing to an unconfirmed example does not retain the previous source. The isolated QA project blocks real account, history, storage, payment and upload access. A selector-only QA ID was added for native inspection, not to production rendering. Twenty-four responsive cases at 320–1180 px and 1×/2× text keep source paragraphs inside the page and retain intentional horizontal formula scrolling.

PASS: the two-file deployment helper rejects invalid archive members/hashes and failed/stale readiness evidence; activation and rollback preserve original code and recover the newly added helper. **Physical phone/tablet, broad source-detection recall and AP/IB-specific provenance remain NOT VERIFIED.**

## Implementation references

[LlamaIndex's citation query engine](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/query_engine/citation_query_engine.py) and [LangChain document metadata](https://github.com/langchain-ai/langchain/blob/master/libs/core/langchain_core/documents/base.py) informed the separation of retrieved source identity from generated prose. No package was installed or implementation copied. The [official DeepSeek vision guide](https://api-docs.deepseek.com/guides/vision/) confirms mixed user text/image input; existing provider settings are unchanged.
