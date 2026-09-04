# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## [LRN-20260809-001] correction

**Logged**: 2026-08-09T12:08:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
The competition area must include a real, source-verified archive of historical papers rather than only a generic practice entry.

### Details
The user explicitly asked for competition historical papers to be found across the web and added to the STEM experience. Treat competition content as a first-class source-backed library with competition, year, paper and answer/solution metadata.

### Suggested Action
Audit the existing competition routes and content model, research official or clearly licensed public archives, then add verified records and UI filters without mixing them into AS/IG/A2 syllabus drills.

### Metadata
- Source: user_feedback
- Related Files: src/data, src/components
- Tags: competition, historical-papers, provenance

### Resolution
- **Resolved**: 2026-08-09T14:00:00+08:00
- **Notes**: Added a first-class Competition stage, verified BPhO/AMC archives, BPhO round coverage, source links, archive gap labels and browser regressions.

---

## [LRN-20260809-002] best_practice

**Logged**: 2026-08-09T13:22:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tests

### Summary
Device QA must fail when its required interaction surface is absent; a conditional skip is not evidence that the interaction works.

### Details
The iPad script only entered the Pencil branch when a recommended practice set happened to contain a non-MCQ item. When the set contained only MCQs, the script still passed and mislabeled a portrait screenshot as landscape because the resize call was inside the skipped branch.

### Suggested Action
Select deterministic content that exercises the required surface, assert that the surface exists, and verify screenshot pixel dimensions in addition to DOM geometry.

### Metadata
- Source: error
- Related Files: scripts/qa-browser.cjs
- Tags: ipad, apple-pencil, visual-qa, conditional-skip

### Resolution
- **Resolved**: 2026-08-09T13:24:00+08:00
- **Notes**: The Pencil journey now uses a real handwritten IGCSE Mathematics topic and fails if no handwritten part is generated.

---

## [LRN-20260809-003] knowledge_gap

**Logged**: 2026-08-09T13:35:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
Legacy BPhO Physics Challenge PDF filename years do not equal the competition years displayed on the official archive page.

### Details
The official 2004 entry links a file named `BPhO_Paper1_2005_QP.pdf`, continuing with a one-year offset through the file named 2011. The official 2005 question-paper and mark-scheme links return 404, so that year must remain a visible source gap rather than being silently relabeled or filled from an unverified mirror.

### Suggested Action
Derive the historical display year from the official source-page heading for the affected files and preserve a `yearSource` field.

### Metadata
- Source: error
- Related Files: scripts/generate-paper-catalog.mjs, src/data/competitionArchive.js
- Tags: bpho, provenance, historical-year, source-gap

### Resolution
- **Resolved**: 2026-08-09T13:50:00+08:00
- **Notes**: Catalogue generation now corrects the 2004-2010 display years and the UI reports missing source years by round.

---
