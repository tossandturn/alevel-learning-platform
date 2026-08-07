# Errors

Command failures and integration errors.

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
