#!/usr/bin/env bash
set -euo pipefail
project_dir="${CHECKIN_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
data_dir="${CHECKIN_DATA_DIR:-$project_dir/data}"
backup_dir="${CHECKIN_BACKUP_DIR:?Set CHECKIN_BACKUP_DIR to a private directory outside data}"
umask 077
mkdir -p "$backup_dir"
# Top-level JSON account files only. Never includes .session, cache.json, .env or Telegram form/session strings.
find "$data_dir" -maxdepth 1 -type f -name '*.json' -printf '%f\0' | tar -C "$data_dir" --null -T - -czf "$backup_dir/checkin-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
