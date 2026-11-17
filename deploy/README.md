# Deployment Templates

These files are examples for a Linux host running the project from:

```text
/opt/glados-checkin-web
```

Adjust paths, user names, domains, TLS settings, and ports for your server
before installing them.

Typical install locations:

- `*.service`: `/etc/systemd/system/`
- `*.timer`: `/etc/systemd/system/`
- `nginx.example.conf`: `/etc/nginx/sites-available/checkin.example.com`

After installing systemd units:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now glados-checkin-web.service
sudo systemctl enable --now glados-checkin-daily.timer
```

Optional timers:

- `embypulse-checkin-daily.timer`
- `embymb-checkin-daily.timer`
- `embykeeper-checkin-daily.timer`
- `telegram-bot-checkin-daily.timer`

VPSNAT 每日签到使用 `vpsnat-checkin-daily.service` / `.timer`，北京时间 10:13 执行。部署时调整服务中的项目路径。

练习生的日常（thxnk.cc）使用 `thxnk-checkin-daily.service` / `.timer`，每日北京时间 10:13 执行，早于网站汇总。安装后运行 `systemctl enable --now thxnk-checkin-daily.timer`。

### WorkBuddy 每日任务

安装 `workbuddy-checkin-daily.service` 和 `workbuddy-checkin-daily.timer` 到 `/etc/systemd/system/`，执行 `systemctl daemon-reload` 与 `systemctl enable --now workbuddy-checkin-daily.timer`。每天北京时间 00:05 执行签到及成长中心，超时上限 1 小时。Web 端手动任务异步运行，共享按 uid 的进程锁。仅导入凭据不会立即发送报告；定时任务沿用现有每日报告配置。

### PR4: opt-in unified runner

The existing per-provider daily service/timer templates are deprecated for new deployments, but remain available and are not disabled by this change. WorkBuddy's hourly growth poll, website summary timer and Emby keepalive timer have different schedules: retain those unless their responsibility is explicitly moved. Do not run a provider daily timer and the unified runner for the same provider together.

1. Review `node scripts/checkin_runner.js --dry-run`; it lists provider names only and neither writes files nor executes check-ins. `RUNNER_PROVIDERS` can select a subset. The runner calls existing scripts sequentially and continues through provider failures, then exits nonzero if any failed.
2. Put configuration in `/etc/glados-checkin.env`, owned by the chosen service user with mode 600. Set a non-default admin password and session secret, each at least 16 characters. The current production admin password must be rotated before deploying the refactor; it is not changed by these commits. Keep the file outside the repository.
3. Ensure `/opt/glados-checkin-web/data` is owned by the service user and mode 700. Session/credential files should be mode 600. Node and Python use Linux `flock` (`util-linux`); lock files end in `.flock` and should never be deleted while workers run. Process exit releases locks automatically. Stop workers before switching implementations or reverting PRs.
4. Install `checkin-runner.service` and `.timer`, adjust paths/user, then run `systemd-analyze verify` and `systemctl daemon-reload`. Start the service once in a maintenance window and inspect its journal before enabling the timer.
5. Disable only the daily timers replaced by the selected providers, then enable `checkin-runner.timer`. The example runs around 00:10 Beijing time with up to 20 minutes of jitter. To preserve WorkBuddy's 00:05 and other existing provider times, keep their timers and exclude them from `RUNNER_PROVIDERS` rather than switching everything at once. The separate hourly WorkBuddy growth poll remains useful.
6. Roll back by disabling the new timer, stopping its service/workers and restoring the recorded old timer enablement state, then reverting PR4. The old templates and account JSON remain compatible. Do not automatically enable previously disabled projects.

`GET /api/healthz` checks a writable data directory, strict account JSON readability and available disk space (default minimum 10 MiB). Optional missing Python/session state is reported as `telegram.ready=false` without failing a pure website deployment. Existing `/api/health` and `/api/v1/health` remain compatible. Set `METRICS_ENABLED=1` for authenticated `/metrics` (Cookie or Bearer); it reports process RSS, summary latency, account/bot counts and last successful check-in timestamps. Request logs carry `X-Request-Id`; they omit request bodies and query strings.

Telegram manual runs return 202 promptly. Poll `/api/embykeeper/job` with a web session or `/api/v1/telegram/jobs` with session/Bearer until completed/failed. Jobs coalesce in one process; kernel locks exclude separate web/timer workers. A restart reports a persisted unfinished job as interrupted. Output is bounded at 64 KiB and is not stored in the job record. Telegram child runtime is capped at ten minutes; no nginx request waits for the worker.

`website_checkin_summary.js` keeps its existing daily summary. A separate alert uses fresh daily failures only and starts at three consecutive days (`FAILURE_ALERT_DAYS=3`); skipped/already/success results do not accumulate failure streaks. Successful alert delivery is acknowledged per day. Install `checkin-logrotate.conf` in `/etc/logrotate.d/` after adjusting ownership/path; worker output stays in journald and should use its retention settings.

For daily account backups, set a private `CHECKIN_BACKUP_DIR` outside data and schedule `bash scripts/backup_data.sh`. It archives top-level JSON only, excluding Telegram form/cache/session files and `.env`. Account JSON contains credentials, including WorkBuddy refresh tokens: restrict access to the archive. Backup creation uses mode 600. To restore, stop workers and copy JSON back with the original owner/mode before restarting. A backup is a point-in-time file copy per JSON file; use a maintenance window if a consistent multi-provider snapshot is required.

### Containers and Python boundary

`Dockerfile` has `web` (Node only) and `worker` (Node + slim Python) targets. Compose uses `worker` for the web service so manual Telegram/WorkBuddy jobs work locally; the optional `runner` profile shares the data volume and runs the same existing scripts. `docker compose --profile runner up -d` is an alternative to systemd scheduling, not an additional scheduler for the same tasks. Mount a private configuration file at the compose `env_file` path; bind the published port to localhost behind nginx. Use the Node-only target for a website-only deployment.

Local OCR was removed at the user's request. No OCR models, ONNX runtime, NumPy, OpenCV or Pillow are installed by `requirements-telegram.txt`; the compatibility hook returns no OCR answer. Telegram protocol/client and mini-app HTTPS entry points remain in Python. Existing image-CAPTCHA tasks require another explicitly selected solution if needed later. Remote verification/mini-app logic is unchanged.

Measured on Debian/Python 3.11: the existing venv fell from about 717 MiB to 258 MiB after removing only OCR-exclusive packages; a fresh minimal Telegram venv is about 109 MiB. The remaining legacy packages in the existing venv were preserved. Package checks and Telegram tests passed without OCR. No production account/session file was rewritten. These measurements do not claim the same size for other Python/platform versions.
