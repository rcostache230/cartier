#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_FILE="$ROOT_DIR/messaging_module/db/schema.sql"
SEED_FILE="$ROOT_DIR/messaging_module/db/seed.sql"
ENV_FILE="$ROOT_DIR/.env"

echo "=== 10Blocuri Messaging Migration ==="

if [[ -f "$ENV_FILE" ]]; then
  echo "Loading environment from $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "No .env file found at $ENV_FILE (continuing with current shell env)"
fi

if [[ -z "${POSTGRES_URL:-}" ]]; then
  echo "ERROR: POSTGRES_URL is not set."
  echo "Set it in .env or export it in your shell before running this script."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is not installed or not in PATH."
  exit 1
fi

if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "ERROR: Schema file not found: $SCHEMA_FILE"
  exit 1
fi

if [[ ! -f "$SEED_FILE" ]]; then
  echo "ERROR: Seed file not found: $SEED_FILE"
  exit 1
fi

run_sql_file() {
  local label="$1"
  local file_path="$2"
  echo "Running: $label"
  if psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -f "$file_path"; then
    echo "SUCCESS: $label"
  else
    echo "FAILED: $label"
    exit 1
  fi
}

run_sql_file "schema migration" "$SCHEMA_FILE"
run_sql_file "seed data" "$SEED_FILE"

echo "=== Messaging migration completed successfully ==="
