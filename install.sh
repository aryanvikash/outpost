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
#   OUTPOST_REPO         github owner/repo (default: aryanvikash/outpost)
#   OUTPOST_NO_SERVICE   set to 1 to skip systemd enable/start
set -eu

REPO="${OUTPOST_REPO:-aryanvikash/outpost}"
BINARY="outpost-agent"
INSTALL_DIR="/usr/local/bin"
CONF_DIR="/etc/outpost"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

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

# Service user.
if ! getent passwd outpost >/dev/null 2>&1; then
  $SUDO useradd --system --no-create-home --shell /usr/sbin/nologin outpost 2>/dev/null || true
fi
$SUDO mkdir -p "$CONF_DIR"

# Systemd unit (downloaded from the tagged source).
unit="$tmp/outpost-agent.service"
download "https://raw.githubusercontent.com/$REPO/$VERSION/packaging/systemd/outpost-agent.service" "$unit" \
  || err "could not fetch systemd unit"
$SUDO install -m 0644 "$unit" /lib/systemd/system/outpost-agent.service

# Enroll: generate a device keypair locally and register its public key. This
# writes the private key (0600) and config under /etc/outpost.
if [ -n "$URL" ] && [ -n "$ENROLL_TOKEN" ]; then
  if [ -f "$CONF_DIR/agent.conf" ] && [ -f "$CONF_DIR/agent.key" ]; then
    log "device already enrolled ($CONF_DIR/agent.key exists); skipping enroll"
  else
    log "enrolling device"
    $SUDO env OUTPOST_URL="$URL" OUTPOST_ENROLL_TOKEN="$ENROLL_TOKEN" OUTPOST_NAME="$NAME" \
      "$INSTALL_DIR/$BINARY" add --url "$URL" --token "$ENROLL_TOKEN" --name "$NAME" \
      --config "$CONF_DIR/agent.conf" --key "$CONF_DIR/agent.key" \
      || err "enrollment failed"
    $SUDO chown -R outpost:outpost "$CONF_DIR"
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
    $SUDO systemctl enable --now outpost-agent
    log "outpost-agent enabled and started"
    log "check status: systemctl status outpost-agent"
  else
    log "enroll first, then: sudo systemctl enable --now outpost-agent"
  fi
fi

log "done."
