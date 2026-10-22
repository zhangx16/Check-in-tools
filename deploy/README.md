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
