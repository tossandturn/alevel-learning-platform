# Errors

Command failures and integration errors.

---

## [ERR-20260809-012] JavaScript path variable was not available inside PowerShell

**Logged**: 2026-08-09T22:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
A read-only reference audit used a JavaScript variable name inside a PowerShell command string, so PowerShell expanded an unset local variable and produced root-relative paths.

### Error
```text
Cannot find path '\references\product-and-physics-domain.md' because it does not exist.
```

### Context
- The outer orchestration variable was not interpolated into the literal command text.
- No repository or application state was changed.

### Suggested Fix
Pass fully expanded absolute paths in the command string, or interpolate the JavaScript value before invoking PowerShell.

### Metadata
- Reproducible: yes
- Related Files: none
- See Also: ERR-20260809-009, ERR-20260809-010

### Resolution
- **Resolved**: 2026-08-09T22:01:00+08:00
- **Notes**: Re-ran the reference audit with explicit absolute paths.

---

## [ERR-20260807-005] Release copy dereferenced nested dependency symlinks

**Logged**: 2026-08-07T03:18:00+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary
Following every symlink while materialising a release turned `node_modules/.bin/vite` into a regular file and broke `vite preview`.

### Error
```text
ERR_MODULE_NOT_FOUND: node_modules/dist/node/cli.js imported from node_modules/.bin/vite
```

### Context
- `cp -a` copied the command-line `current` symlink instead of its contents, producing a nested release link.
- Retrying with `cp -aL` followed all nested links, including package-manager `.bin` links.
- PM2 entered `errored` state and the STEM proxy briefly returned 502; IELTS remained online.

### Suggested Fix
When cloning a symlinked release, resolve only the top-level source or use `cp -aH source/. target/`. Preserve nested `node_modules` symlinks and verify `.bin/vite` is still a link before switching `current`.

### Metadata
- Reproducible: yes
- Related Files: node_modules/.bin/vite

### Resolution
- **Resolved**: 2026-08-07T03:19:00+08:00
- **Notes**: Recreated a physical release, restored dependency symlinks from the prior working release, restarted only `alevel-physics`, and rechecked both public sites.

---

## [ERR-20260807-004] Windows SCP wildcard upload stalled

**Logged**: 2026-08-07T03:12:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary
Recursive `scp` with a quoted Windows wildcard started SSH but transferred no files to the release directory.

### Error
```text
The scp process remained active while the remote target directory stayed empty.
```

### Context
- The source was a Vite `dist\*` tree containing hundreds of files.
- A single archive uploaded successfully over the same SSH key and connection.
- The existing production release was not activated until hashes matched.

### Suggested Fix
Package `dist` as one `.tar.gz`, upload that explicit file, extract into a fresh release directory, verify hashes, then atomically switch the release symlink.

### Metadata
- Reproducible: unknown
- Related Files: dist

### Resolution
- **Resolved**: 2026-08-07T03:12:00+08:00
- **Notes**: Used a single archive transfer and completed the isolated STEM release successfully.

---

## [ERR-20260807-003] MCQ type reconciliation

**Logged**: 2026-08-07T03:36:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
Page OCR labelled one question as handwritten while its exact mark scheme supplied an A-D answer key.

### Error
`Cannot read properties of undefined (reading '3')`

### Context
- The importer attempted to map answer `D` through an options array that only existed for OCR-labelled MCQs.
- No partial question-index write occurred.

### Suggested Fix
Treat an explicit A-D answer key in the paired mark scheme as authoritative evidence that the item is multiple choice.

### Metadata
- Reproducible: yes
- Related Files: scripts/import-question-index.mjs

### Resolution
- **Resolved**: 2026-08-07T03:38:00+08:00
- **Notes**: MCQ type now reconciles QP OCR with the exact answer key before option mapping.

---

## [ERR-20260807-002] smoke test contract drift

**Logged**: 2026-08-07T03:18:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
The smoke fixture still expected five generated questions after the production contract changed to at least ten verified past-paper items.

### Error
`AssertionError: AS Physics Waves Coach request must become a chapter drill action`

### Context
- Coach now returns `questionCount: 10` and `sourceRequest: verified-topic-drill`.
- The obsolete fixture also expected a generated-practice label.

### Suggested Fix
Assert the verified-source contract, imported-bank integrity and cross-qualification routing.

### Metadata
- Reproducible: yes
- Related Files: scripts/smoke.mjs

### Resolution
- **Resolved**: 2026-08-07T03:22:00+08:00
- **Notes**: Updated the smoke contract and added Chemistry, Economics, BPhO, ESAT and TMUA intent coverage.

---

## [ERR-20260807-001] question-index PDF rendering

**Logged**: 2026-08-07T03:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
The question importer could not invoke the bundled Poppler renderer through its outer Windows command wrapper.

### Error
`pdftoppm failed: The system cannot find the path specified.`

### Context
- `spawnSync` used `shell: true` with the wrapper found on PATH.
- The bundled `pdftoppm.exe` itself rendered the same PDF successfully.

### Suggested Fix
Resolve the bundled executable directly and run it with `shell: false` so paths and arguments are not re-escaped by multiple command layers.

### Metadata
- Reproducible: yes
- Related Files: scripts/import-question-index.mjs

### Resolution
- **Resolved**: 2026-08-07T03:04:00+08:00
- **Notes**: Added direct bundled-executable discovery with a normal PATH fallback.

---

## [ERR-20260807-006] PowerShell reserved HOME variable in production check

**Logged**: 2026-08-07T16:46:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
A public HTTPS verification assigned the response to `$home`, which PowerShell reserves as a read-only variable.

### Suggested Fix
Use a task-specific variable such as `$stemResponse` in PowerShell deployment checks.

### Resolution
- **Resolved**: 2026-08-07T16:46:00+08:00
- **Notes**: The check was rerun with `$stemResponse`; `https://stem.ieltsist.com/` returned 200 and referenced the latest bundle.

---

## [ERR-20260809-001] ripgrep Windows wildcard path

**Logged**: 2026-08-09T12:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
Passing `src\\*.css` as a path to ripgrep failed because Windows did not expand the wildcard.

### Error
```text
rg: src\\*.css: The filename, directory name, or volume label syntax is incorrect. (os error 123)
```

### Context
- A parallel source audit passed shell-style wildcard paths to `rg` under PowerShell.
- No project files were changed and the remaining checks were rerun with directory roots.

### Suggested Fix
Search an explicit directory and use ripgrep's `-g '*.css'` filter on Windows.

### Metadata
- Reproducible: yes
- Related Files: src
- Recurrence-Count: 2
- Last-Seen: 2026-08-09

### Resolution
- **Resolved**: 2026-08-09T12:00:00+08:00
- **Notes**: Replaced wildcard path arguments with directory roots and `-g` filters.

---

## [ERR-20260809-002] wait called without a running exec cell

**Logged**: 2026-08-09T12:30:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
The orchestration `wait` tool was called with placeholder cell IDs even though no command had yielded a running cell.

### Error
```text
Script error: exec cell not found
```

### Context
- `wait` only resumes an `exec` call that returned `Script running with cell ID ...`.
- No project command, source file, or application state was affected.

### Suggested Fix
Use normal tool calls for immediate work and call `wait` only with the exact cell ID returned by a yielded long-running `exec` call.

### Metadata
- Reproducible: yes
- Related Files: none

### Resolution
- **Resolved**: 2026-08-09T12:30:00+08:00
- **Notes**: Continued with direct repository inspection commands.

---

## [ERR-20260809-003] assumed paper catalog path

**Logged**: 2026-08-09T12:35:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
A repository inspection assumed the paper catalog lived at `public/paper-catalog.json` instead of its configured path.

### Error
```text
Cannot find path 'public/paper-catalog.json' because it does not exist.
```

### Context
- The generator and importer both use `public/data/papers.json`.
- The failed read did not modify project files.

### Suggested Fix
Read the generator or importer path constant before inspecting a generated artifact.

### Metadata
- Reproducible: yes
- Related Files: scripts/generate-paper-catalog.mjs, scripts/import-question-index.mjs

### Resolution
- **Resolved**: 2026-08-09T12:36:00+08:00
- **Notes**: Located and used `public/data/papers.json`.

---

## [ERR-20260809-004] paper filter browser selector was ambiguous

**Logged**: 2026-08-09T13:05:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
The browser QA selector for the `Paper` filter also matched the `Type` filter because one option was named `Question papers`.

### Error
```text
strict mode violation: selector resolved to Paper and Type selects
```

### Context
- Competition/Admissions separation and all BPhO round checks had already passed.
- The ambiguity occurred after switching back to a Cambridge paper route.

### Suggested Fix
Give every paper-library select an explicit accessible name and use exact role/name selectors in QA.

### Metadata
- Reproducible: yes
- Related Files: src/components/PaperLibrary.jsx, scripts/qa-browser.cjs

### Resolution
- **Resolved**: 2026-08-09T13:07:00+08:00
- **Notes**: Added explicit `aria-label` values and exact Playwright selectors.

---

## [ERR-20260809-005] handwriting QA assumed every route had a default recommendation

**Logged**: 2026-08-09T13:20:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
The iPad Pencil flow switched to IGCSE Mathematics but reused an AS Physics helper that expected the primary action to open session setup immediately.

### Error
```text
Timeout waiting for .session-setup
```

### Context
- IGCSE Mathematics correctly showed `Choose a topic` because no default topic had been selected.
- The prior conditional Pencil branch could skip all ink checks when the recommended set contained only multiple-choice questions.

### Suggested Fix
Use a dedicated route-aware QA journey and fail when the required handwriting surface is absent instead of conditionally skipping it.

### Metadata
- Reproducible: yes
- Related Files: scripts/qa-browser.cjs
- Recurrence-Count: 2
- Last-Seen: 2026-08-09

### Resolution
- **Resolved**: 2026-08-09T13:24:00+08:00
- **Notes**: Pencil QA now follows Choose a topic -> Number -> Practice, accepts the topic flow's direct workspace entry, and locates a generated unit containing handwritten parts.

---

## [ERR-20260809-006] malformed ripgrep stage audit pattern

**Logged**: 2026-08-09T14:05:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
A final audit combined escaped array syntax into an invalid ripgrep regular expression.

### Error
```text
regex parse error: unclosed group
```

### Context
- The failed command was read-only and did not affect source or test results.
- The audit only needed literal searches for the shared stage constant.

### Suggested Fix
Use `rg -F` for literal source-contract searches instead of escaping code fragments as regex.

### Metadata
- Reproducible: yes
- Related Files: src/data/stages.js

### Resolution
- **Resolved**: 2026-08-09T14:06:00+08:00
- **Notes**: Reran literal searches; App, RoleWorkspace and smoke all use `COURSE_STAGE_ORDER`.

---

## [ERR-20260809-007] invalid wait session identifier

**Logged**: 2026-08-09T14:35:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
The orchestration layer attempted to wait on a session ID that had never been returned by an execution call.

### Error
```text
exec cell unused not found
```

### Context
- The failed call did not modify files or interrupt the running Vite server.

### Suggested Fix
Call `wait` only with a real cell ID returned by a still-running `exec` invocation.

### Metadata
- Reproducible: yes
- Related Files: none

### Resolution
- **Resolved**: 2026-08-09T14:35:00+08:00
- **Notes**: Continued with direct execution calls because no background cell existed.

---

## [ERR-20260809-008] parallel audit propagated no-match exit code

**Logged**: 2026-08-09T14:38:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
One `rg` audit returning exit code 1 for no matches caused the surrounding parallel execution to stop without returning the successful sibling outputs.

### Error
```text
Script error: Exit code: 1
```

### Context
- The audit was read-only and no source files were affected.
- For absence checks, ripgrep exit code 1 is an expected result rather than a product failure.

### Suggested Fix
Run absence searches as individually labeled checks or normalize the expected no-match status before aggregating results.

### Metadata
- Reproducible: yes
- Related Files: src, scripts

### Resolution
- **Resolved**: 2026-08-09T14:38:00+08:00
- **Notes**: Switched to individual audit calls so each result remains visible and interpretable.

---

## [ERR-20260809-009] PowerShell split a complex ripgrep stage expression

**Logged**: 2026-08-09T14:42:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
A combined alternation containing quoted JavaScript arrays and stage comparisons was split into path arguments by Windows PowerShell.

### Error
```text
rg: system cannot find the path specified
```

### Context
- The audit was read-only and no source files were affected.
- Simpler fixed-string checks were sufficient for the contract being audited.

### Suggested Fix
Use `rg -F` with one literal per call on Windows, and normalize exit code 1 when no matches are the expected outcome.

### Metadata
- Reproducible: yes
- Related Files: src/data/stages.js
- See Also: ERR-20260809-006, ERR-20260809-008

### Resolution
- **Resolved**: 2026-08-09T14:43:00+08:00
- **Notes**: Reran fixed-string stage and legacy-color searches with explicit `NO_MATCHES` output.

---

## [ERR-20260809-010] secret-audit classifier quoting failed across PowerShell and Node

**Logged**: 2026-08-09T15:02:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
Two read-only attempts to classify secret-pattern matches failed because nested quote characters were reinterpreted by PowerShell before the regex or inline Node script ran.

### Error
```text
PowerShell parser error followed by a Node eval syntax error with stripped string quotes
```

### Context
- Neither failed attempt printed field values or modified source files.
- The audit needed only field names and expression types, never the underlying values.

### Suggested Fix
For redacted PowerShell classifiers, compare the first character by numeric char code instead of embedding quote-heavy regular expressions or inline scripts.

### Metadata
- Reproducible: yes
- Related Files: src, scripts
- See Also: ERR-20260809-009

### Resolution
- **Resolved**: 2026-08-09T15:05:00+08:00
- **Notes**: A char-code based PowerShell classifier completed and confirmed only empty application tokens, identifiers/environment references, and two smoke-test string fixtures.

---

## [ERR-20260809-011] invalid agent wait routed to exec session wait

**Logged**: 2026-08-09T15:25:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
Agent monitoring incorrectly called the execution-cell wait tool with a fabricated cell ID instead of the collaboration agent wait tool.

### Error
```text
exec cell no not found
```

### Context
- The failure affected only coordinator polling.
- Both delegated implementation tasks continued running and no repository or service state changed.

### Suggested Fix
Use `collaboration.wait_agent` for task-tree agents and reserve `functions.wait` for a real cell ID returned by `functions.exec`.

### Metadata
- Reproducible: yes
- Related Files: none
- See Also: ERR-20260809-007
- Recurrence-Count: 2
- Last-Seen: 2026-08-09

### Resolution
- **Resolved**: 2026-08-09T15:26:00+08:00
- **Notes**: Switched monitoring to the collaboration agent channel while retaining only fresh Codex thread snapshots for the IELTSist task; a second attempt to reuse a closed cell confirmed the prevention rule.

---
