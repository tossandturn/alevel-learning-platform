# Chapter-independent start contract

Status: `PASS_LOCAL_NOT_DEPLOYED`

Baseline commit: `a17196cb18a2aa87e05d2be861a3b064585a9a82`

## Contract

- Chapter Study is chapter-local: a selected chapter may start when its selected component has at least one complete eligible question.
- A request is capped to that chapter/component's actual available count. It does not borrow questions from another chapter or depend on route-wide readiness.
- Chapter Study remains `study-only` and `formalProgressEligible: false`.
- Legacy Topic Drill remains separate: minimum set size 6 and formal-ready threshold 12 reviewed distinct source groups.
- Original foundation questions establish chapter-level study availability only. They do not count as official past-paper coverage or formal reviewed coverage.

## Reproduction

```powershell
npm run test:chapter-independent-start
```

The focused test exercises the authenticated-independent API contract in memory for all 22 syllabus practice routes and all 222 chapters. For every chapter it starts:

1. a v1 `original-foundation-only` request for 15 questions and requires `available=1`, `count=1`, `limited=true`;
2. a v2 `official-first` request for 15 questions and requires `count=min(15, available)`;
3. a chapter-only result set with study-only, non-formal flags.

It also asserts the unchanged legacy constants `MIN_QUESTION_GROUPS_PER_TEST=6` and `MIN_VERIFIED_GROUPS_FOR_PRACTICE=12`, and proves one question alone does not make legacy Topic Drill startable.

## Current data evidence

| Route | Chapters | With official questions | Official gaps |
| --- | ---: | ---: | ---: |
| `cie-0580-igcse-mathematics` | 9 | 8 | 1 |
| `cie-0606-igcse-additional-mathematics` | 14 | 9 | 5 |
| `cie-0625-igcse-physics` | 6 | 6 | 0 |
| `cie-9702-as-physics` | 11 | 11 | 0 |
| `cie-9702-a2-physics` | 14 | 0 | 14 |
| `cie-9709-as-p1-p2` | 14 | 0 | 14 |
| `cie-9709-as-p1-p4` | 13 | 0 | 13 |
| `cie-9709-as-p1-p5` | 13 | 0 | 13 |
| `cie-9709-a2-after-p1-p5-p3-p4` | 14 | 0 | 14 |
| `cie-9709-a2-after-p1-p5-p3-p6` | 14 | 0 | 14 |
| `cie-9709-a2-after-p1-p4-p3-p5` | 14 | 0 | 14 |
| `cie-0610-igcse-biology` | 19 | 0 | 19 |
| `cie-9700-as-biology` | 12 | 0 | 12 |
| `cie-9700-a2-biology` | 9 | 0 | 9 |
| `cie-9701-as-chemistry` | 15 | 0 | 15 |
| `cie-9701-a2-chemistry` | 8 | 0 | 8 |
| `cie-9708-as-economics` | 6 | 0 | 6 |
| `cie-9708-a2-economics` | 5 | 0 | 5 |
| `cie-9231-as-p1-p3` | 3 | 0 | 3 |
| `cie-9231-as-p1-p4` | 3 | 0 | 3 |
| `cie-9231-a2-after-p1-p3-p2-p4` | 3 | 0 | 3 |
| `cie-9231-a2-after-p1-p4-p2-p3` | 3 | 0 | 3 |
| **Total** | **222** | **34** | **188** |

All 222 chapters are independently startable because every chapter has at least one complete original-foundation question in v1. The 188 official gaps are content backlog, not a runtime start-coupling defect. No runtime/API change was required by this audit.
