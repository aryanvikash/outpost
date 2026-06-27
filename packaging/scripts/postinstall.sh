#!/bin/sh
# Runs after the .deb/.rpm installs. Creates the non-root service user and
# prepares the config directory. Does NOT auto-start (no token yet).
set -e

if ! getent passwd outpost >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin outpost 2>/dev/null \
    || adduser --system --no-create-home --shell /usr/sbin/nologin outpost 2>/dev/null \
    || true
fi

mkdir -p /etc/outpost
if [ ! -f /etc/outpost/agent.conf ] && [ -f /etc/outpost/agent.conf.example ]; then
  cp /etc/outpost/agent.conf.example /etc/outpost/agent.conf
fi
chown -R outpost:outpost /etc/outpost 2>/dev/null || true
chmod 0600 /etc/outpost/agent.conf 2>/dev/null || true

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
  echo "Outpost agent installed. Edit /etc/outpost/agent.conf, then:"
  echo "  sudo systemctl enable --now outpost-agent"
fi
