# Release and QA status — 2026-09-04

## STEM production

- Release: `20260904-v2-827cd3d`
- Source commit: `827cd3d2febacd46d10f4e1237f21ad11aeec5dd`
- Release scope: `cie-9702-as-physics` (AS, P1 + P2)
- Scope gate: 11/11 syllabus topics ready, 120 reviewed question groups; the complete-catalog report remains visible and currently has 222 below-floor topic blockers.
- Server verifier: passed against the governed PDF library and the shared rendered-asset tree; no source build was run on the 2 GiB-class production host.
- Activation: atomic `current` switch, only PM2 `alevel-physics` restarted. Previous releases `20260904-v1-7c8530b` and `20260902-v2-8dd9392` remain available for rollback.
- Post-activation checks: loopback `/healthz` and `/api/health` returned `ok`; public STEM health, AI status, syllabus inventory, and all native iOS route URLs returned 200. IELTSist health and `/api/tasks` remained healthy.

The release-scope gate is deliberate: routes outside the scope remain discoverable but are labelled study-only or source-indexing until their own QP/MS evidence reaches the same reviewed floor. No unreviewed OCR or provisional content is promoted to formal progress or official scoring.

## iOS

- GitHub iOS `main`: `6c0fd41`.
- Latest verified main run: `33827183627`; student iPad suite 4/4 and QA suite 4/4 passed.
- The native shell now has deterministic dashboard tab handoff, route-specific Coach WebView reset, warm deep-link system handoff, and a direct camera bridge that can return a compressed image to the originating web input on iOS versions where WebKit does not expose a custom upload panel.

Simulator evidence is not a real-device acceptance: Apple Pencil latency/continuous strokes, camera hardware, microphone permission, signed distribution, and TestFlight still require a physical iPad and Apple Developer signing.

## Mini Program

- GitHub `master`: `124ce42`; Actions run `33810434992` passed.
- Contract suite covers phone/tablet classification, portrait/landscape layout, camera-only STEM capture, crop, server inventory, shared auth/session cleanup, AI Coach failure states, and route mirroring.
- WeChat DevTools CLI authentication is still an external setup step; a fresh simulator screenshot has not been treated as production evidence.
