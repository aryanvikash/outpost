#!/bin/sh
# Outpost agent installer.
#
#   curl -fsSL https://<host>/install.sh | sh
#
# Detects OS/arch, downloads the matching release binary from GitHub Releases,
# verifies its SHA-256 checksum, installs to /usr/local/bin, installs the systemd
# unit, then enrolls the device (generates an Ed25519 keypair locally and
# registers its public key using a one-time enroll token).
#
# Environment:
#   OUTPOST_VERSION      pin a version (e.g. v0.1.0); default: latest
#   OUTPOST_URL          control-plane wss URL       (else prompted)
#   OUTPOST_ENROLL_TOKEN one-time enroll token oet_… (else prompted)
#   OUTPOST_NAME         optional machine name (defaults to hostname)
#   OUTPOST_RUN_USER     user the agent runs as (default: the sudo-invoking user)
#   OUTPOST_FORCE_ENROLL set to 1 to drop the existing identity and re-enroll
#   OUTPOST_REPO         github owner/repo (default: aryanvikash/outpost)
#   OUTPOST_NO_SERVICE   set to 1 to skip systemd enable/start
#
# The agent runs as a real login user (the one who ran the installer) so deploy
# hooks can reach that user's app dirs, git, node, and pm2 with no extra setup.
# Hooks live in ~/.config/outpost/hooks (create them with: outpost-agent hook
# edit deploy) — no sudo, no chmod.
set -eu

REPO="${OUTPOST_REPO:-aryanvikash/outpost}"
BINARY="outpost-agent"
INSTALL_DIR="/usr/local/bin"
CONF_DIR="/etc/outpost"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
warn() { printf '\033[1;33m!!! %s\033[0m\n' "$*" >&2; }

need() { command -v "$1" >/dev/null 2>&1 || err "missing required command: $1"; }
need uname
need tar

# Prefer sudo when not root.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || err "run as root or install sudo"
  SUDO="sudo"
fi

# --- uninstall: curl -fsSL .../install.sh | sh -s uninstall ------------------
if [ "${1:-}" = "uninstall" ]; then
  if command -v outpost-agent >/dev/null 2>&1; then
    exec $SUDO outpost-agent uninstall --yes
  fi
  log "removing outpost-agent"
  $SUDO systemctl disable --now outpost-agent 2>/dev/null || true
  $SUDO rm -f /lib/systemd/system/outpost-agent.service /etc/systemd/system/outpost-agent.service
  $SUDO rm -rf /etc/systemd/system/outpost-agent.service.d
  $SUDO systemctl daemon-reload 2>/dev/null || true
  $SUDO rm -f "$INSTALL_DIR/$BINARY"
  $SUDO rm -rf "$CONF_DIR"
  log "uninstalled. Remember to revoke the device in the dashboard."
  exit 0
fi

# --- detect platform ---------------------------------------------------------
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$os" in
  linux) ;;
  darwin) ;;
  *) err "unsupported OS: $os" ;;
esac

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) arch="amd64" ;;
  aarch64|arm64) arch="arm64" ;;
  *) err "unsupported architecture: $arch" ;;
esac

# --- resolve version ---------------------------------------------------------
fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1";
  elif command -v wget >/dev/null 2>&1; then wget -qO- "$1";
  else err "need curl or wget"; fi
}
download() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL -o "$2" "$1";
  elif command -v wget >/dev/null 2>&1; then wget -qO "$2" "$1";
  else err "need curl or wget"; fi
}

VERSION="${OUTPOST_VERSION:-}"
if [ -z "$VERSION" ]; then
  log "resolving latest release of $REPO"
  VERSION="$(fetch "https://api.github.com/repos/$REPO/releases/latest" \
    | grep -m1 '"tag_name"' | cut -d '"' -f4)"
  [ -n "$VERSION" ] || err "could not determine latest version (set OUTPOST_VERSION)"
fi
log "installing $BINARY $VERSION ($os/$arch)"

# --- download + verify -------------------------------------------------------
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

ver_noV="${VERSION#v}"
asset="outpost-agent_${ver_noV}_${os}_${arch}.tar.gz"
base="https://github.com/$REPO/releases/download/$VERSION"

log "downloading $asset"
download "$base/$asset" "$tmp/$asset"
download "$base/checksums.txt" "$tmp/checksums.txt"

log "verifying checksum"
expected="$(grep " $asset\$" "$tmp/checksums.txt" | awk '{print $1}')"
[ -n "$expected" ] || err "no checksum entry for $asset"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
else
  err "need sha256sum or shasum to verify download"
fi
[ "$expected" = "$actual" ] || err "checksum mismatch: expected $expected got $actual"

# --- install binary ----------------------------------------------------------
tar -xzf "$tmp/$asset" -C "$tmp"
$SUDO install -m 0755 "$tmp/$BINARY" "$INSTALL_DIR/$BINARY"
log "installed $INSTALL_DIR/$BINARY"

# --- config + service (linux/systemd only) -----------------------------------
if [ "$os" != "linux" ]; then
  log "non-linux host: binary installed; skipping systemd setup"
  exit 0
fi

URL="${OUTPOST_URL:-}"
ENROLL_TOKEN="${OUTPOST_ENROLL_TOKEN:-}"
NAME="${OUTPOST_NAME:-}"
if [ -z "$URL" ] && [ -t 0 ]; then printf "Control-plane URL (wss://...): "; read -r URL; fi
if [ -z "$ENROLL_TOKEN" ] && [ -t 0 ]; then printf "Enroll token (oet_...): "; read -r ENROLL_TOKEN; fi

# Run user: the agent runs as a REAL login user so deploy hooks can reach that
# user's app dirs, git, node, and pm2 with no extra setup. Default to whoever
# invoked the installer via sudo; fall back to a prompt, then root.
RUN_USER="${OUTPOST_RUN_USER:-${SUDO_USER:-}}"
if [ -z "$RUN_USER" ] || [ "$RUN_USER" = "root" ]; then
  if [ -t 0 ]; then printf "Run the agent as which user? [root]: "; read -r RUN_USER; fi
  RUN_USER="${RUN_USER:-root}"
fi
getent passwd "$RUN_USER" >/dev/null 2>&1 || err "user '$RUN_USER' does not exist (set OUTPOST_RUN_USER)"
RUN_GROUP="$(id -gn "$RUN_USER")"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
[ -n "$RUN_HOME" ] || err "could not determine home for '$RUN_USER'"
log "agent will run as: $RUN_USER ($RUN_HOME)"

$SUDO mkdir -p "$CONF_DIR"

# Systemd unit (downloaded from the tagged source).
unit="$tmp/outpost-agent.service"
download "https://raw.githubusercontent.com/$REPO/$VERSION/packaging/systemd/outpost-agent.service" "$unit" \
  || err "could not fetch systemd unit"
$SUDO install -m 0644 "$unit" /lib/systemd/system/outpost-agent.service

# Drop-in override: run as the chosen user, let deploy hooks reach the home, and
# pin the hooks dir to an ABSOLUTE path under the run user's home (don't rely on
# systemd exporting $HOME — it may not, which would silently fall back to /etc).
# No post-install chmod/chown needed.
HOOKS_DIR="$RUN_HOME/.config/outpost/hooks"
ov_dir="/etc/systemd/system/outpost-agent.service.d"
ov="$tmp/override.conf"
cat > "$ov" <<OVERRIDE
[Service]
User=$RUN_USER
Group=$RUN_GROUP
ProtectHome=false
ReadWritePaths=$RUN_HOME
Environment=OUTPOST_HOOKS_DIR=$HOOKS_DIR
OVERRIDE
$SUDO mkdir -p "$ov_dir"
$SUDO install -m 0644 "$ov" "$ov_dir/override.conf"

# Hooks dir in the run user's home, owned by them (no sudo to add hooks later),
# pre-seeded with an editable deploy template. (HOOKS_DIR set above.)
$SUDO install -d -o "$RUN_USER" -g "$RUN_GROUP" -m 0755 \
  "$RUN_HOME/.config" "$RUN_HOME/.config/outpost" "$HOOKS_DIR"
if [ ! -e "$HOOKS_DIR/deploy" ] && [ ! -e "$HOOKS_DIR/deploy.example" ]; then
  tmpl="$tmp/deploy.example"
  cat > "$tmpl" <<'HOOK'
#!/bin/sh
# Outpost deploy hook — rename to `deploy` (or run: outpost-agent hook edit deploy).
# Edit the two values, then save. No chmod needed.
set -eu

APP_DIR="$HOME/myapp"     # <-- your app directory
PM2_APP="myapp"           # <-- your pm2 process name

cd "$APP_DIR"
echo "==> deploy $PM2_APP (branch=${OUTPOST_BRANCH:-current})"
git pull --ff-only
npm ci
npm run build
pm2 restart "$PM2_APP" --update-env
echo "==> done"
HOOK
  $SUDO install -o "$RUN_USER" -g "$RUN_GROUP" -m 0644 "$tmpl" "$HOOKS_DIR/deploy.example"
fi

# Re-enroll: OUTPOST_FORCE_ENROLL=1 drops the existing identity so a fresh enroll
# token registers a NEW machine (use after revoking the old one).
if [ "${OUTPOST_FORCE_ENROLL:-0}" = "1" ]; then
  log "force re-enroll: removing existing identity"
  $SUDO rm -f "$CONF_DIR/agent.conf" "$CONF_DIR/agent.key"
fi

# Enroll: generate a device keypair locally and register its public key. This
# writes the private key (0600) and config under /etc/outpost.
if [ -n "$URL" ] && [ -n "$ENROLL_TOKEN" ]; then
  if [ -f "$CONF_DIR/agent.conf" ] && [ -f "$CONF_DIR/agent.key" ]; then
    # An enroll token was supplied but this box already has an identity. The user
    # almost certainly meant to register a device — don't silently skip.
    warn "============================================================"
    warn "ENROLL TOKEN IGNORED — this device is already enrolled."
    warn "Existing key: $CONF_DIR/agent.key"
    warn "No NEW device was registered and your token was NOT used."
    warn ""
    warn "To register a fresh device, re-run with OUTPOST_FORCE_ENROLL=1:"
    warn "  ... OUTPOST_FORCE_ENROLL=1 OUTPOST_ENROLL_TOKEN=$ENROLL_TOKEN sh"
    warn "(this drops the old identity; revoke the old machine in the dashboard)"
    warn "============================================================"
  else
    log "enrolling device"
    $SUDO env OUTPOST_URL="$URL" OUTPOST_ENROLL_TOKEN="$ENROLL_TOKEN" OUTPOST_NAME="$NAME" \
      "$INSTALL_DIR/$BINARY" add --url "$URL" --token "$ENROLL_TOKEN" --name "$NAME" \
      --config "$CONF_DIR/agent.conf" --key "$CONF_DIR/agent.key" \
      || err "enrollment failed"
    # The run user must own its key/config to read them.
    $SUDO chown -R "$RUN_USER:$RUN_GROUP" "$CONF_DIR"
    $SUDO chmod 0600 "$CONF_DIR/agent.key" "$CONF_DIR/agent.conf"
  fi
else
  log "no URL/enroll token supplied; run 'outpost-agent add --url ... --token oet_...' to enroll"
fi

if [ "${OUTPOST_NO_SERVICE:-0}" = "1" ]; then
  log "skipping service start (OUTPOST_NO_SERVICE=1)"
  exit 0
fi

if command -v systemctl >/dev/null 2>&1; then
  $SUDO systemctl daemon-reload
  if [ -f "$CONF_DIR/agent.conf" ]; then
    # `restart` also starts it if stopped, and (unlike enable --now) ensures a
    # re-install picks up the new binary even if the old one was running.
    $SUDO systemctl enable outpost-agent
    $SUDO systemctl restart outpost-agent
    log "outpost-agent enabled and (re)started"
    log "check status: systemctl status outpost-agent"
  else
    log "enroll first, then: sudo systemctl enable --now outpost-agent"
  fi
fi

log "done."
