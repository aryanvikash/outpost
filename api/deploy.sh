#!/bin/sh
# Outpost API deploy wrapper.
#
# Usage:
#   ./deploy.sh            full deploy: login → ensure D1 → migrate → deploy → ensure ADMIN_TOKEN
#   ./deploy.sh dev        local dev: apply local migrations, ensure .dev.vars, run `wrangler dev`
#   ./deploy.sh setup      first-time setup only (login + D1 + secret), no deploy
#   ./deploy.sh migrate    apply remote migrations only
#
# Idempotent: re-running is safe. The first run patches wrangler.toml with the
# created D1 database_id and generates an ADMIN_TOKEN if one isn't set.
#
# Env overrides:
#   DATABASE_ID   use an existing D1 id instead of creating one
#   ADMIN_TOKEN   use this admin token instead of generating one
#   D1_NAME       D1 database name (default: outpost)
set -eu

# Run from the api dir regardless of where invoked.
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

WRANGLER="npx wrangler"
D1_NAME="${D1_NAME:-outpost}"
TOML="wrangler.toml"
PLACEHOLDER="REPLACE_WITH_YOUR_D1_DATABASE_ID"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

ensure_login() {
  if ! $WRANGLER whoami >/dev/null 2>&1; then
    log "not logged in — launching wrangler login (completes in your browser)"
    $WRANGLER login
  fi
  log "logged in as: $($WRANGLER whoami 2>/dev/null | grep -i 'associated with the email' || echo 'ok')"
}

# Set $DB_ID to the D1 database id, creating the DB and patching wrangler.toml
# on first run.
ensure_d1() {
  # 1. explicit override
  if [ -n "${DATABASE_ID:-}" ]; then
    DB_ID="$DATABASE_ID"
  # 2. already configured in wrangler.toml
  elif grep -q "$PLACEHOLDER" "$TOML"; then
    DB_ID=""
  else
    DB_ID="$(grep -E '^[[:space:]]*database_id' "$TOML" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
  fi

  if [ -z "${DB_ID:-}" ]; then
    log "creating D1 database '$D1_NAME'"
    out="$($WRANGLER d1 create "$D1_NAME" 2>&1 || true)"
    DB_ID="$(printf '%s\n' "$out" | grep -Eo 'database_id = "[^"]+"' | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
    if [ -z "$DB_ID" ]; then
      printf '%s\n' "$out" >&2
      err "could not determine database_id (already exists? set DATABASE_ID=... and re-run)"
    fi
  fi

  # Patch the placeholder in wrangler.toml (portable in-place edit).
  if grep -q "$PLACEHOLDER" "$TOML"; then
    sed "s|$PLACEHOLDER|$DB_ID|" "$TOML" > "$TOML.tmp" && mv "$TOML.tmp" "$TOML"
    log "wrote database_id ($DB_ID) into $TOML"
  else
    log "D1 database_id already set ($DB_ID)"
  fi
}

ensure_admin_token() {
  # secret list only works once the worker exists; tolerate failure pre-deploy.
  if $WRANGLER secret list 2>/dev/null | grep -q '"ADMIN_TOKEN"'; then
    log "ADMIN_TOKEN secret already set"
    return
  fi
  token="${ADMIN_TOKEN:-}"
  generated=0
  if [ -z "$token" ]; then
    if command -v openssl >/dev/null 2>&1; then
      token="$(openssl rand -base64 32 | tr -d '\n=' | tr '+/' '-_')"
    else
      token="$(head -c 32 /dev/urandom | base64 | tr -d '\n=' | tr '+/' '-_')"
    fi
    generated=1
  fi
  log "setting ADMIN_TOKEN secret"
  printf '%s' "$token" | $WRANGLER secret put ADMIN_TOKEN
  if [ "$generated" = "1" ]; then
    printf '\033[1;32m\nADMIN_TOKEN (save this now — it is shown only once):\n  %s\n\n\033[0m' "$token"
  fi
}

migrate_remote() {
  log "applying remote D1 migrations"
  $WRANGLER d1 migrations apply "$D1_NAME" --remote
}

do_deploy() {
  ensure_login
  ensure_d1
  migrate_remote
  log "deploying worker"
  $WRANGLER deploy
  ensure_admin_token
  log "done. Mint an enroll token, then install an agent:"
  cat <<'EOF'

  curl -X POST https://<your-worker>/api/enroll-tokens \
    -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"uses":1}'

  # on the server:
  curl -fsSL https://raw.githubusercontent.com/aryanvikash/outpost/main/install.sh | \
    OUTPOST_URL=wss://<your-worker>/connect OUTPOST_ENROLL_TOKEN=oet_... sh
EOF
}

do_dev() {
  if [ ! -f .dev.vars ]; then
    log "creating .dev.vars with a throwaway ADMIN_TOKEN (gitignored)"
    {
      echo "ADMIN_TOKEN=dev-admin-token"
      echo "GITHUB_WEBHOOK_SECRET=dev-webhook-secret"
    } > .dev.vars
  fi
  log "applying local D1 migrations"
  $WRANGLER d1 migrations apply "$D1_NAME" --local
  log "starting local API on http://localhost:8787 (Ctrl-C to stop)"
  exec $WRANGLER dev --port 8787 --local
}

case "${1:-deploy}" in
  deploy)  do_deploy ;;
  dev)     do_dev ;;
  setup)   ensure_login; ensure_d1; ensure_admin_token ;;
  migrate) ensure_login; migrate_remote ;;
  *)       err "unknown command: $1 (use: deploy | dev | setup | migrate)" ;;
esac
