#!/usr/bin/env bash
set -euo pipefail

IELTS_ENV="/home/ubuntu/ielts-trainer/.env"
STEM_ENV="/home/ubuntu/alevel-physics/shared/.env"

if [[ ! -f "$IELTS_ENV" || ! -f "$STEM_ENV" ]]; then
  echo "Expected production environment files are missing." >&2
  exit 1
fi

key="${STEM_INTERNAL_AUTH_KEY:-}"
if [[ -z "$key" ]]; then
  key="$(grep '^STEM_INTERNAL_AUTH_KEY=' "$IELTS_ENV" | tail -n 1 | cut -d= -f2- || true)"
fi
if [[ -z "$key" ]]; then
  key="$(grep '^STEM_IDENTITY_SIGNING_KEY=' "$IELTS_ENV" | tail -n 1 | cut -d= -f2- || true)"
fi
if [[ -z "$key" ]]; then
  echo "A canonical shared auth key is required; refusing to generate a replacement key." >&2
  exit 1
fi

set_key() {
  local file="$1"
  local temporary
  temporary="$(mktemp)"
  KEY="$key" awk '
    BEGIN { value = ENVIRON["KEY"] }
    /^STEM_INTERNAL_AUTH_KEY=/ {
      if (!internalWritten) {
        print "STEM_INTERNAL_AUTH_KEY=" value
        internalWritten = 1
      }
      next
    }
    { print }
    END {
      if (!internalWritten) print "STEM_INTERNAL_AUTH_KEY=" value
    }
  ' "$file" > "$temporary"
  cat "$temporary" > "$file"
  rm -f "$temporary"
  chmod 600 "$file"
}

set_key "$IELTS_ENV"
set_key "$STEM_ENV"
echo "Shared identity configuration is ready."
