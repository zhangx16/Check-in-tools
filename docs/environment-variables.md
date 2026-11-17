# Environment variable index

Required HTTP secrets and operational defaults are documented in `.env.example`. This static index lists provider/worker-specific switches without reading any live environment or secret files. Internal inherited lock descriptors are not user configuration. See the referenced source for optional per-provider fallbacks.

| Variable | Read in |
| --- | --- |
| `ADMIN_PASS` | `lib/config.js:8` |
| `ADMIN_USER` | `lib/config.js:7` |
| `APP_API_TOKEN` | `lib/config.js:11` |
| `APP_API_TOKEN_SECONDARY` | `lib/config.js:13` |
| `CHECKIN_API_TOKEN` | `lib/config.js:11` |
| `CHECKIN_BOT_USERNAMES` | `scripts/telegram_bot_checkin.py:1580` |
| `CHECKIN_CONCURRENCY` | `lib/daily.js:18` |
| `CHECKIN_DATA_DIR` | `lib/common.js:5` |
| `CHECKIN_LOCK_FD` | `scripts/telegram_worker_lock.py:12` |
| `CHECKIN_MAX_ATTEMPTS` | `lib/daily.js:16` |
| `CHECKIN_PROJECT_ROOT` | `scripts/telegram_bot_checkin.py:26` |
| `CHECKIN_RETRY_DELAY_MS` | `lib/daily.js:17` |
| `CHECKIN_STORE_RAW` | `lib/accounts.js:82` |
| `DEFAULT_EMBYMB_BASE_URL` | `lib/app.js:44` |
| `DEFAULT_EMBYPULSE_BASE_URL` | `lib/app.js:42` |
| `DEFAULT_VPSNAT_BASE_URL` | `lib/app.js:90` |
| `EMBYMB_ACCOUNTS_FILE` | `lib/accounts.js:23` |
| `EMBYPULSE_ACCOUNTS_FILE` | `lib/accounts.js:20` |
| `EMBY_KEEPALIVE_FILE` | `lib/emby-keepalive-store.js:5` |
| `FAILURE_ALERT_DAYS` | `scripts/website_checkin_summary.js:214` |
| `GLADOS_ACCOUNTS_FILE` | `lib/accounts.js:17` |
| `GLADOS_CF_PYTHON` | `lib/glados-cf.js:7` |
| `HEALTH_MIN_FREE_BYTES` | `lib/app.js:287` |
| `HOST` | `lib/config.js:4` |
| `ICON_FETCH_ENABLED` | `lib/icons/cache.js:23` |
| `METRICS_ENABLED` | `lib/app.js:383` |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `lib/common.js:76` |
| `PORT` | `lib/config.js:5` |
| `REQUEST_TIMEOUT_MS` | `lib/common.js:65` |
| `RUNNER_PROVIDERS` | `scripts/checkin_runner.js:9` |
| `RUNNER_TASK_TIMEOUT_MS` | `scripts/checkin_runner.js:23` |
| `SESSION_SECRET` | `lib/config.js:9` |
| `TELEGRAM_ALERT_ON_FAILURE` | `lib/daily.js:19` |
| `TELEGRAM_API_HASH` | `scripts/telegram_bot_checkin.py:21` |
| `TELEGRAM_API_ID` | `scripts/telegram_bot_checkin.py:20` |
| `TELEGRAM_BOT_TOKEN` | `lib/daily.js:20` |
| `TELEGRAM_CHAT_ID` | `lib/telegram.js:10` |
| `TELEGRAM_DRY_RUN` | `lib/telegram.js:12` |
| `THXNK_ACCOUNTS_FILE` | `lib/accounts.js:30` |
| `VPSNAT_ACCOUNTS_FILE` | `lib/accounts.js:26` |
| `WORKBUDDY_ACCOUNTS_FILE` | `lib/accounts.js:29` |
| `WORKBUDDY_BUDGET_SECONDS` | `lib/providers/workbuddy.js:37` |
| `WORKBUDDY_PYTHON` | `lib/providers/workbuddy.js:38` |
| `ZZCAT_ACCOUNTS_FILE` | `lib/accounts.js:31` |
