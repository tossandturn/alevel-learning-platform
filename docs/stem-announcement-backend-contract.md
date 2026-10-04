# STEM announcement backend contract

Protocol: `stem-announcements-v1`

## Backend and client boundary

- Announcement content, ordering, pinning, expiry, archive state and read receipts are server-owned and persisted in SQLite.
- Existing Mini Program 1.0.33 clients read this protocol through the current announcement APIs. Publishing or editing compatible announcement data does not require a client package upload.
- Client feature or presentation changes remain a separate release stream.

## Authorization

- Public announcement listing remains readable without a session.
- Read receipts require an authenticated user.
- Management listing, publish, edit, pin and archive require a server-verified `school_admin` or `school_owner` role.
- Client-supplied identity or role fields are never authoritative.

## Action routes

- Action URLs must use a pathname that literally matches the registered in-app route allowlist.
- URL normalization must not turn an unregistered raw path into an allowed path. Dot segments, encoded dot segments, backslashes, external origins and fragments are rejected.
- Query keys remain restricted to the protocol allowlist and retain their existing length and control-character checks.

## Expiry lifecycle

- A published announcement may only be created or updated with a future ISO expiry.
- Once an announcement has expired, it is excluded from the public list.
- A draft or archive update may preserve an existing syntactically valid past expiry. This lets the management client archive expired announcements without rewriting their historical expiry.
- Invalid timestamps remain rejected for every status.

## Verification

`npm run test:announcements` covers permissions, publish, edit, pin, archive, expiry, pagination, read receipts, route safety and persistence after reopening the database.
