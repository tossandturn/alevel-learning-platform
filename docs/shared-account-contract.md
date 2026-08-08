# STEM shared account contract

STEM uses the IELTSist account as its identity provider. STEM does not create a second password, copy the IELTSist database, or persist the provider access token.

## Public discovery

`GET https://stem.ieltsist.com/api/auth/config`

The response declares the provider origin, browser login/register/logout URLs, provider API paths, session cookie ownership, token storage rules, and stable response status codes. This endpoint contains no secrets and is safe to cache only for the current browser session.

## Browser flow

1. STEM sends the student to the IELTSist Mine page with `from=stem`, `auth=login` or `auth=register`, `return_to`, and `#mine`.
2. IELTSist owns username/password validation, duplicate identifier handling, the `ieltsist_session` HttpOnly cookie, and logout.
3. After the student returns to STEM, STEM calls `GET https://ieltsist.com/api/stem/identity` with `credentials: include`.
4. IELTSist returns a five-minute HS256 handoff token. STEM keeps it in memory only and uses it as a Bearer token for `/api/auth/status` and `/api/stem/*`.

The token must have `iss=ieltsist.com`, `aud=stem.ieltsist.com`, a subject in the form `ielts:<numeric id>`, and a future `exp`. STEM verifies the signature, issuer, audience, subject and expiry before any class or private-note operation.

## Provider API contract

- `POST /api/auth/login`: `{ "username": string, "password": string }` -> `200` with `{ token, expiresAt, user }`; invalid credentials -> `401`.
- `POST /api/auth/register`: `{ "username": string, "password": string }` -> `200` with `{ token, expiresAt, user }`; validation -> `400`; duplicate identifier -> `409`.
- `POST /api/auth/logout`: provider clears `ieltsist_session` and returns `200 { "ok": true }`.
- `GET /api/me`: authenticated provider session -> `200 { user }`; absent/expired session -> `401`.
- `GET /api/stem/identity`: `Origin: https://stem.ieltsist.com`, `credentials: include` -> `200 { identity, accessToken, expiresAt }`; absent/expired session -> `401`.

The identity exchange must return `Access-Control-Allow-Origin: https://stem.ieltsist.com`, `Access-Control-Allow-Credentials: true`, `Vary: Origin`, and allow only `GET, OPTIONS`. It must never use `*` with credentials. Provider logout is a browser navigation until the provider also allows a credentialed, origin-restricted POST from STEM.

## STEM private Notebook API

- `GET /api/stem/notebook/notes?routeId=<registered routeId>` -> `{ routeId, note, privacy: "private-to-student" }`.
- `PUT /api/stem/notebook/notes/<registered routeId>` with `{ "body": string }` -> the same note shape.
- `DELETE /api/stem/notebook/notes/<registered routeId>` -> `{ routeId, note: null, privacy: "private-to-student" }`.

Notes are keyed by `(provider user id, routeId)`, are excluded from workspace/report responses, and are never readable by teachers or school admins through their own identity. The client keeps an offline copy and syncs after a debounced edit when the shared session is connected.

## Verification

```powershell
npm run test:shared-workspace
curl.exe -sS https://stem.ieltsist.com/api/auth/config
curl.exe -i -X OPTIONS https://ieltsist.com/api/stem/identity -H "Origin: https://stem.ieltsist.com"
```

The last command is a provider-side integration check. A credentialed response must include the restricted origin and credentials headers described above.
