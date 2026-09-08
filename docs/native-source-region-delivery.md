# Native source region transport

`POST /api/stem/practice-sets` accepts the presentation-only opt-in header
`X-STEMist-Source-Images: region-v2`. It cannot change content eligibility,
identity, marking permission or source mappings. Responses vary on this header.

Version 2 descriptors preserve source-page geometry and add the exact rendered
pixel size. The image URL adds `view=region`; this uses the trusted region from
the current released bank, not a client rectangle. The existing bounded image
queue verifies original PNG bytes, crops at integer boundaries without scaling,
then caches the derived PNG separately from the full page. Revocation is checked
again after processing and before cache access. AI source hydration is unchanged.

Legacy URLs return the original PNG and old practice-set requests retain version
1 descriptors. No source PDF/PNG, history or existing session is rewritten.

`scripts/test-native-source-region-delivery.mjs` verifies exact decoded pixels,
geometry, source binding, cache revocation and backwards compatibility. The
paired native-client test checks decoding, reserved aspect ratio and restoration.
