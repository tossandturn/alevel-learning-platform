# Written and multipart independent review v2 — design only

Status: `DESIGN_ONLY_NOT_IMPLEMENTED_NOT_RELEASED`

This phase defines a future independent-review envelope for written, drawn and multipart questions. It does not change `ai-independent-source-review.v1`, call a provider, approve the six 0580 questions, or make any artifact student-eligible.

## Proposed envelope

Use a new schema name such as `ai-independent-written-source-review.v2`. Keep the existing MCQ v1 validator and A–D contract unchanged.

The review binds:

- artifact ID, route, source question ID and ordered part labels;
- QP/MS PDF SHA-256 values;
- each part's exact QP page, normalized region and page-image SHA-256;
- every shared diagram region needed by that part;
- each part's exact MS page, normalized region and page-image SHA-256;
- marks, primary topic and syllabus point IDs;
- provider/model identity distinct from the primary source reviewer;
- the complete candidate, verification, primary source review and review result through the existing canonical binding digest.

## Provider result

The result is one whole-question object with an ordered `parts` array. Each part contains:

1. `label`, `marks` and `responseModality` (`written`, `coordinate-drawing`, or another explicitly supported modality);
2. an independent QP-only derivation or construction proof produced before viewing the MS answer;
3. a structured derived result, such as transformation type and parameters or an ordered vertex set;
4. the MS comparison and whether it is equivalent to the independent result;
5. exact QP, shared-diagram and MS evidence bindings;
6. a part decision and bounded disagreement records.

The top-level decision can be `accept` only when every part accepts, the part order and marks match the artifact exactly, and all evidence hashes and regions remain bound. Written answers must never be converted into A–D choices or given synthetic `answerKey` fields.

## Adjudications

A source disagreement may be accepted only when it names a pinned local adjudication and reproduces its deterministic proof. For `cie-0580-0580_w25_qp_33:q21` part `b`, the reviewer must independently apply `(x,y) -> (x,-y)` before comparing with the printed MS. The local sign-slip record remains private annotation, leaves the source unchanged, and must state `officialErrataClaimed: false`.

## Fail-closed rules

- Missing, duplicate, unknown or ambiguous part labels block the artifact.
- A part page must match its `reviewed-part-page-binding-v1` declaration.
- Exactly one QP part region and one MS part region must bind each part; shared diagrams are separately labelled.
- A provider/model matching the primary reviewer blocks two-pass release.
- Any mismatch in marks, topic, syllabus points, hashes, coordinates or resolved adjudication blocks release.
- Review failure leaves the artifact unpublished with `studentStudyEligible: false` and `formalProgressEligible: false`.

## Compatibility and rollout boundary

The backend derives trusted exact context from the current canonical question and `partId`. Mini 1.0.33 may omit new v2-only evidence fields; any fields it does supply must match, and the server persists/signs the full canonical binding. This is compatibility behavior, not permission to accept a client-selected page, region, label or answer.

Implementation, provider prompts, paid calls, release construction, client changes and production rollout are explicitly deferred to a later approved phase.
