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
