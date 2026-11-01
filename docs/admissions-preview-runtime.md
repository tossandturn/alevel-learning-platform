# Admissions Source Preview Runtime

Source cards are attached to the completed Admissions assistant turn. Each
public source contains a server-extracted `excerpt` of at most 900 characters
and preview metadata only; screenshot bytes are never stored in conversation
metadata. The client requests a preview after the answer through:

```text
POST /api/ai/admissions/source-preview
{"conversationId":"...","turnId":"...:assistant","sourceId":"S1-..."}
```

The route requires the signed STEM identity and resolves the source from that
owner's completed assistant turn. It accepts no URL or query parameters and
does not use the PDF/audio allowance. Screenshot bytes live in a bounded
in-process cache for no more than three days. Expiry, restart, source HTTP
failure, timeout or unavailable renderer returns an SVG `excerpt-card` based on
the persisted official excerpt. It is never labelled as a webpage screenshot.

Assistant turn source metadata contains the random source ID, title, official
URL, retrieval time, current verification fields, a source-only excerpt, and:

```json
{
  "previewId": "apv_<opaque>",
  "path": "/api/ai/admissions/source-preview",
  "kind": "static-webpage-screenshot",
  "status": "pending",
  "mimeType": "image/png",
  "width": 390,
  "height": 900,
  "sourceUrl": "https://official.example/course",
  "capturedAt": null,
  "expiresAt": "...",
  "reason": null
}
```

The preview response is `{excerpt, preview}`. `preview` adds base64 only at
request time. Ready screenshots are PNG, at most 2 MB and 100–1600 by
100–2400. Their reason identifies either the real requirements section or page
first screen and states that JavaScript was disabled and some remote assets may
be omitted. Fallback/expired cards use safe inline SVG.

## Runtime Artifact

The host reads one immutable artifact directory:

```text
/home/ubuntu/alevel-physics/tools/admissions-preview-1.64.1/
  manifest.json
  renderer.cjs
  seccomp_profile.json
  playwright-core-1.64.1.tgz
  LICENSE-playwright
  package/
    package.json
    ... playwright-core 1.64.1 package files
```

`manifest.json`:

```json
{
  "version": "1.64.1",
  "image": "mcr.microsoft.com/playwright@sha256:<resolved-64-hex-digest>",
  "packageSha256": "<sha256-of-playwright-core-1.64.1.tgz>",
  "packageTreeSha256": "<deterministic-sha256-of-extracted-package-tree>",
  "rendererSha256": "<sha256-of-renderer.cjs>",
  "seccompSha256": "<sha256-of-seccomp_profile.json>",
  "license": "Apache-2.0"
}
```

Build this artifact on an approved builder, never on production. Pin the npm
package exactly to `playwright-core@1.64.1`; the registry integrity independently
checked for this release is:

```text
sha512-BC4s8y6SEVA6Q1rSxZTto8hI1KUI3xXlHGZgvGqP4IqPdI/a6FX9H29IDNz7vKo9l21b6LfYosScPL6M3xxyDQ==
```

Copy [admissions-preview-renderer.cjs](../scripts/admissions-preview-renderer.cjs)
as `renderer.cjs`. Download the tag-pinned official Playwright seccomp profile:

```text
https://raw.githubusercontent.com/microsoft/playwright/v1.64.1/utils/docker/seccomp_profile.json
```

Pull `mcr.microsoft.com/playwright:v1.64.1-noble` on the approved builder,
resolve its repository digest, write that digest to the manifest, and upload the
completed directory atomically. Production performs no `npm install`, package
extraction, image build or source build.
Before activation, compute `rendererSha256` over the exact worker and
`packageTreeSha256` over the extracted package by sorting relative POSIX paths
and hashing each `path + NUL + byte-size + NUL + file-bytes + NUL`. The loader
rejects symbolic links, more than 10,000 files, more than 64 MB, or a tarball,
package tree, renderer or seccomp hash mismatch.

Read-only hash helper on the completed builder artifact:

```text
node scripts/hash-admissions-preview-runtime.mjs /absolute/runtime/directory
```

## Isolation

The server creates one ephemeral container per requested source preview. The
only host bind is the fully hash-verified, fixed, public runtime artifact at
`/runtime`, mounted read-only. No user directory, credential location or Docker
socket is mounted. Runtime constraints are:

- non-root `1000:1000`, `chromiumSandbox: true`, no `--no-sandbox`;
- `--network none`, read-only root, private IPC, independent 128 MB shm;
- 64 MB noexec/nosuid/nodev tmpfs, all capabilities dropped;
- official seccomp profile, no-new-privileges, no SYS_ADMIN/unconfined mode;
- 128 PIDs, one CPU, 512 MB memory, application concurrency one;
- JavaScript and service workers disabled; every browser network request aborted.

Renderer stdin is exactly `{html,width,height}`. Stdout on success is exactly
`{mimeType:"image/png",base64,width,height,focus}` where `focus` is
`requirements-section` or `page-first-screen`; failure exits nonzero. The
worker loads `require('/runtime/package')` and receives no source URL,
credential, account identifier or student record.

The parent process first validates the public URL/DNS/redirect chain and fetches
bounded HTML plus at most four same-domain stylesheets and eight same-domain
images. CSS imports/URLs, scripts, event handlers, frames, forms and all remote
references are removed. Only this in-memory offline document enters Chromium.

Read-only offline fixture smoke after the artifact and exact Docker image digest
exist on the candidate host:

```text
npm run smoke:admissions-preview-renderer
```

The smoke sends a fixed local HTML fixture into a `--network none` container and
prints only renderer version, PNG dimensions/bytes and elapsed time. It reads no
credential, student record, source URL or application database and performs no
service restart.
