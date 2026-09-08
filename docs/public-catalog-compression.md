# Public catalog JSON transport

Source-backed native practice sets repeat question, part, diagram and provenance
metadata. Preserve those fields; compress their transport instead of stripping
evidence or lengthening the Mini Program request deadline.

`sendPublicCatalogJson` is explicitly enabled for paper catalogs, public paper
source-context, syllabus inventory and guest practice-set generation. Responses
with Authorization, Cookie or Set-Cookie stay outside this compressor. Auth,
capabilities, saved work, rebind, error JSON and Coach SSE retain their own paths.
All catalog responses remain `Cache-Control: no-store`.

The helper negotiates gzip, honors explicit refusal and identity preference,
merges `Vary: Accept-Encoding`, and sets the compressed byte length. Async zlib
level 1 keeps compression off the event loop. Bodies under 1 KiB, bodies that do
not shrink and compression failures retain the original JSON. A disconnected
client is not written to after compression.

Run `npm run test:catalog-compression` for real loopback HTTP tests including
decoding equality, source IDs/evidence, quality values and private boundaries.
The six-question AS fixture falls from approximately 51.7 KB to 7.1 KB (86%).
This is transport evidence, not a claim of physical-device performance or AI
marking accuracy. The production Mini Program journey must still pass.

References:

- [Node.js asynchronous HTTP compression](https://nodejs.org/api/zlib.html#compressing-http-requests-and-responses)
- [RFC 9110 Accept-Encoding negotiation](https://www.rfc-editor.org/rfc/rfc9110.html#name-accept-encoding)
