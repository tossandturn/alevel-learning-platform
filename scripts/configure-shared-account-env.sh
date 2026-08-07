#!/usr/bin/env bash
set -euo pipefail

IELTS_ENV="/home/ubuntu/ielts-trainer/.env"
STEM_ENV="/home/ubuntu/alevel-physics/current/.env"

if [[ ! -f "$IELTS_ENV" || ! -f "$STEM_ENV" ]]; then
  echo "Expected production environment files are missing." >&2
  exit 1
fi

key="$(grep '^STEM_IDENTITY_SIGNING_KEY=' "$IELTS_ENV" | tail -n 1 | cut -d= -f2- || true)"
if [[ -z "$key" ]]; then
  key="$(openssl rand -hex 32)"
fi

set_key() {
  local file="$1"
  local temporary
  temporary="$(mktemp)"
  awk -v value="$key" '
    /^STEM_IDENTITY_SIGNING_KEY=/ {
      if (!written) {
        print "STEM_IDENTITY_SIGNING_KEY=" value
        written = 1
      }
      next
    }
    { print }
    END {
      if (!written) print "STEM_IDENTITY_SIGNING_KEY=" value
    }
  ' "$file" > "$temporary"
  cat "$temporary" > "$file"
  rm -f "$temporary"
  chmod 600 "$file"
}

set_key "$IELTS_ENV"
set_key "$STEM_ENV"
echo "Shared identity configuration is ready."
