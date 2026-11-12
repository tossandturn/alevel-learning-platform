# Physics Coach diagrams implementation plan

> **For implementer:** Use TDD throughout. Write failing tests, observe failure, then implement. No production changes in this subtask.

**Goal:** Make useful physics diagrams a normal part of Coach teaching, especially accurate free-body diagrams, while preserving hint/exam limits and existing native clients.

**Architecture:** The existing client already renders validated `stem-diagram-v1` primitives. Add a server-only `stem-force-v1` semantic recipe compiled into those existing primitives. The compiler determines vector geometry; it does not infer missing forces, magnitudes, equilibrium or source facts. Keep general diagrams on the existing bounded primitive schema.

**Tech stack:** Existing Node ESM Coach middleware, native Mini Program canvas, Node assert tests; no dependency or provider change.

## Tasks

1. Add `scripts/test-coach-physics-diagram.mjs` with horizontal/incline/free-fall/tension fixtures; reject unsupported or contradictory force recipes, missing basis, invalid surface/axes, unsafe content, no automatic extra forces. Run it and observe missing compiler failure.
2. Add `server/coachPhysicsDiagram.js`; route accepted semantic recipes through `server/coachDiagram.js` to canonical v1. Test complete/chunked streams, invalid/incomplete fallback and no capability leakage.
3. Extend `server/coachPolicy.js` with a single reusable physics drawing instruction and precise recipe contract; preserve direct answer, bounded hint, unreadable photo, exam and language policies. Test prompt variants and the HTTP/SSE/photo/recoverable-job path.
4. Test canonical output with the unchanged native parser/canvas at phone and tablet sizes, capture fresh rendered fixtures, inspect labels and direction geometry. Only edit native renderer if a real defect is reproduced.
5. Run existing diagram, answer-policy/API, language, image and job suites. Record exact coverage and limitations in QA notes. Root owns integrated deployment and live-provider acceptance.

## Research / attribution

- [OpenStax: Drawing Free-Body Diagrams](https://openstax.org/books/university-physics-volume-1/pages/5-7-drawing-free-body-diagrams): checked physical principles (external forces on a chosen body; separate force vectors from acceleration/resultant and avoid double-counting components). No textbook text, illustrations or questions are copied into prompts/assets/tests.
- [PhET original model documentation](https://github.com/phetsims/forces-and-motion-basics/blob/main/doc/model.md): considered force/vector presentation patterns. No PhET source or media is copied; therefore no added dependency. Repository license was not verified and reuse is not authorized by this review.

## Limits

Schema validation and deterministic geometry cannot establish whether the model interpreted an unseen photograph correctly. Source statements remain model-supplied; no claim of official answer verification. Missing contact/motion information must produce a stated limitation rather than an invented friction direction. Hardware/real-device acceptance remains separate from canvas/native-simulator tests.
