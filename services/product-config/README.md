# Product configuration service

Dependency-free loopback service for public native presentation configuration. It does not own authentication, prompts, entitlements, scores, attempts, student records, provider credentials, or executable client behavior.

The runtime store must be an absolute directory outside this source directory. Publish the mechanically exported client defaults before starting the service. The packaged Tavern icon allowlist is a separate JSON array and is required by every command.

## Publish

```text
node services/product-config/publish.mjs --store D:\runtime\stem-product-config --channel release --expected-current none --icon-allowlist D:\runtime\tavern-icons.json --input D:\release\defaults.json
```

Use the exact active revision instead of `none` for every later publication. Immutable revision bytes are retained; the channel pointer moves only when expected-current CAS succeeds.

## Roll back

```text
node services/product-config/rollback.mjs --store D:\runtime\stem-product-config --channel release --expected-current foundation-v2 --revision foundation-v1 --icon-allowlist D:\runtime\tavern-icons.json
```

Rollback validates the stored target revision and changes only the selected channel pointer.

## Serve

```text
node services/product-config/serve.mjs --store D:\runtime\stem-product-config --icon-allowlist D:\runtime\tavern-icons.json --host 127.0.0.1 --port 4310
```

Only `127.0.0.1` and `::1` are accepted. Public reads are `GET`/`HEAD /api/product/config?channel=release&capability=1`; health is `GET`/`HEAD /healthz`. Deployment, reverse-proxy configuration and client publication are separate gated operations.

## Wire contract

`channel` defaults to `release`; `capability=1` is required. A successful `GET` returns the exact immutable publication bytes with:

- `Content-Type: application/json; charset=utf-8`
- exact `Content-Length`
- `Cache-Control: no-cache`
- strong `ETag: "<lowercase SHA-256 of the response bytes>"`
- `X-Content-Type-Options: nosniff`

`HEAD` returns the same selected-publication headers and no body. `If-None-Match` accepts `*`, an exact tag, or a comma-separated list containing the exact tag; a match returns `304`, `ETag` and `Cache-Control: no-cache` with no body. ETags are channel-publication identities, not user/session identities.

All configuration strings must already be trimmed and reject C0/C1 controls and unpaired UTF-16 surrogates. Copy URLs require canonical lowercase ASCII DNS hosts and stable bounded decoding. Raw whitespace, encoded controls, separators and traversal are rejected; an encoded ordinary path space such as `%20` is preserved and allowed.

`/healthz` returns `200` with `{ok,service,schemaVersion,channels}` and `Cache-Control: no-store`. It contains no paths, secrets or student state.

All HTTP and CLI failures use the exact versioned JSON envelope:

```json
{"schemaVersion":"stemist-product-config-error-v1","ok":false,"code":"invalid_query","error":"Configuration query is invalid."}
```

HTTP errors never include a stack or filesystem path. CLI errors write one envelope to stderr and exit `1`.

| HTTP | Codes |
| --- | --- |
| `400` | `invalid_request_target`, `invalid_query`, `invalid_capability`, `invalid_channel`, `request_body_not_allowed` |
| `404` | `not_found` |
| `405` | `method_not_allowed` with `Allow: GET, HEAD` |
| `409` | `unsupported_capability` |
| `503` | `config_unavailable`, `config_corrupt` |
| `500` | `internal_error` |

Publication and service CLI validation additionally uses `invalid_arguments`, `input_file_invalid`, `icon_allowlist_invalid`, `store_path_unsafe`, `host_not_loopback`, `port_invalid`, `invalid_json`, `invalid_config`, `config_too_large`, `invalid_revision`, `expected_current_mismatch`, `revision_bytes_conflict` and `publication_busy`; stored-state failures retain `config_unavailable` or `config_corrupt`. `none` is accepted only as the CLI `--expected-current` sentinel for an absent pointer; it is never a valid publication or rollback revision.

## Store layout

```text
runtime-store/
  revisions/<revision>.json
  channels/release.json
  channels/trial.json
  channels/develop.json
  locks/
```

Revision files are immutable. Channel pointer replacement uses a per-channel lock, expected-current compare-and-swap, file fsync, atomic rename and directory fsync where the operating system supports it.

Each channel lock is atomically installed only after durable owner metadata exists. The owner binds PID, process-start identity and a random token. A live owner is never displaced; a dead owner can be recovered, while missing or malformed owner metadata must remain older than the bounded grace period before recovery. Release verifies the same owner identity and token. Revision size is checked against 128 KiB before any existing or active revision is read into memory.
