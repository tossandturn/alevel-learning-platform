# A-Level Learning Platform Notes

- This project is an independent A-Level Physics and Math learning platform. Do not reuse IELTS production paths, ports, environment files, databases, or deployment artifacts.
- Keep source material provenance explicit. Seed questions may be Cambridge-style practice, but official PDF-derived content must be imported with stable IDs, source file names, checksum/page metadata, and copyright status.
- Preserve the learning loop: discover -> choose scope -> setup -> attempt -> submit -> score -> inspect evidence -> improve -> retest.
- Store guest attempts append-only in localStorage. Do not mutate original attempts when reviewing or retesting.
- Use deterministic scoring for objective, numeric, unit, and explicit mark-point checks. Label estimates clearly.
