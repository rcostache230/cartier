#!/usr/bin/env bash
set -euo pipefail

if ! command -v vercel >/dev/null 2>&1; then
  echo "vercel CLI not found. Install with: npm i -g vercel"
  exit 1
fi

required=(
  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET
)

missing=0
for k in "${required[@]}"; do
  if [[ -z "${!k:-}" ]]; then
    echo "Missing env var: $k"
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "Export required variables first, then rerun."
  exit 1
fi

scopes=(production preview development)
vars=(
  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET
  R2_ENDPOINT
  R2_REGION
  FLASK_SECRET_KEY
  POSTGRES_URL
  DATABASE_URL
  POSTGRES_URL_NON_POOLING
)

for scope in "${scopes[@]}"; do
  for key in "${vars[@]}"; do
    value="${!key:-}"
    if [[ -n "$value" ]]; then
      printf '%s' "$value" | vercel env add "$key" "$scope" --force >/dev/null
      echo "Set $key ($scope)"
    fi
  done
done

echo "Done. Trigger a new Vercel deploy."
