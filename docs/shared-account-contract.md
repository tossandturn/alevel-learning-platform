# STEM native account contract

STEM and IELTSist use the same account database. Each product owns its own
browser login screen and session cookie: STEM never redirects a learner to
IELTSist to authenticate.

## Student flow

1. The student opens the STEM account dialog on `stem.ieltsist.com`.
2. STEM posts credentials to its own `/api/auth/login` or `/api/auth/register`.
3. STEM verifies those credentials server-to-server against the shared
   IELTSist account database using a signed loopback request.
4. STEM creates only a `stem_session` HttpOnly cookie for this origin and
   returns a short-lived in-memory STEM API token.
5. STEM logout clears only `stem_session`. It does not navigate to or clear
   an IELTSist browser session.

Credentials, upstream account cookies, internal signatures, and upstream
tokens must never reach client storage, URLs, exports, screenshots, or logs.

## Public discovery

`GET /api/auth/config` returns the stable `stem-native-account-v1` contract:

- browser endpoints: `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`
- session restore endpoint: `/api/auth/status`
- cookie owner: `stem.ieltsist.com`
- token storage: memory only

## Server configuration

Set the same dedicated value on both product servers:

```text
STEM_INTERNAL_AUTH_KEY=<shared server-only secret>
```

During migration, `STEM_IDENTITY_SIGNING_KEY` is accepted as the fallback.
`STEM_AUTH_INTERNAL_ORIGIN` may only be a loopback HTTP origin such as
`http://127.0.0.1:4321`; production browser traffic never uses that origin.

The durable STEM database path is configured with:

```text
STEM_DATABASE_PATH=/stable/shared/data/stem.sqlite
```

`STEM_DB_PATH` remains supported for existing installations. Do not store the
database under a release directory.

## Verification

```powershell
node scripts/test-stem-native-auth.mjs
npm run test:shared-workspace
```

The native auth test covers invalid credentials, same-origin session restore,
STEM-only logout, and absence of credential or upstream-token echoes.
