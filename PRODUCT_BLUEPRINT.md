# A-Level Studio Product Blueprint

## Who this is for

### Student (C)

The student does not start with a catalogue. They start by choosing a route:

- IGCSE: 0580, 0606, 0610, 0625
- AS: the first-year component set for 9700, 9701, 9702, 9708, 9709, 9231
- A2: the continuation components, not a generic "advanced" label
- Competition: BPhO, ESAT, TMUA, AMC12
- IELTS: academic vocabulary needed to read and explain STEM questions

The product then recommends one next action based on syllabus coverage, real attempts, time, and mistakes. A student can see the original question, write in one answer area, ask Coach for a bounded hint, submit, inspect the exact mark point, and retest the same skill.

### Teacher (B)

The teacher creates a class, selects a syllabus point and stage, and assigns a verified question set. A task contains a stable assignment ID, share code, due date, question-source policy, and the exact QP/MS bindings. The teacher feed shows completion, marks, elapsed time, hint level, mistake tags, AI confidence, and whether manual review is needed. Private student notes stay private unless explicitly shared.

### School (B)

The school sees programme coverage and risk by cohort, class, subject, stage and syllabus point. It does not see every student's notebook by default. The school action is a decision: reteach a concept, support a group, or adjust a department plan.

## Evidence contract

`syllabus -> paper -> question part -> answer entity -> explicit binding -> attempt -> score -> feedback -> retest`

Questions and answers remain separate entities. Official source pages, document hashes, specification version and QP/MS verification status travel with every practice item. AI is an assisted reviewer with confidence and review-required state; it is never presented as an official examiner.

## Sharing contract

IELTS-ist is the canonical account service. STEM requests a five-minute, STEM-only handoff token from the logged-in IELTS-ist session and verifies it server-side; it never receives or stores an IELTS password, session cookie or membership record.

STEM server storage contains classrooms, permissioned class memberships, verified-source assignments and append-only, idempotent submitted-assignment events keyed by the IELTS-ist account ID. A browser role preview does not grant teacher or school privileges. Guest practice remains local-first and is deliberately separate from account-backed class work.

Before school reporting can be shown as an official record, add teacher-administered school membership approval, server-canonical marking for each submitted question, export controls, retention/deletion policy, and a student migration/consent flow for existing local history.

## Current official source anchors

- 0610: https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-biology-0610/
- 0610 syllabus (2026-2028): https://www.cambridgeinternational.org/Images/697203-2026-2028-syllabus.pdf
- 9700: https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-biology-9700/
- 9700 syllabus (2025-2027): https://www.cambridgeinternational.org/Images/664560-2025-2027-syllabus.pdf

## Delivery gates

- A topic unlocks only with at least ten verified QP/MS-bound questions.
- A new paper is indexed, tagged to the current syllabus, paired to its mark scheme, audited, and only then exposed to students.
- New role views must pass student, teacher and school permission tests separately.
