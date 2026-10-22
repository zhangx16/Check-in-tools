#!/usr/bin/env bash
# Compatibility entry point. No Embykeeper package is installed or invoked.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/telegram_bot_checkin_once.sh" "$@"
