#!/bin/sh
# Runs before the package is removed: stop and disable the service.
set -e

if command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now outpost-agent 2>/dev/null || true
fi
