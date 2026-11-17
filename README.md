# Emby Check-in Tools

多站点与 Telegram Bot 自动签到。签到由脚本和定时任务执行，可通过网页工作台或 API 查看结果。

当前支持：

- GLaDOS Cookie 签到
- EmbyPulse 账号密码签到
- EmbyMB 账号密码签到
- 这只猫用户中心（`https://user.090911.xyz`）Cookie 签到
- 癫影（`@madowchat_bot`）Telegram `/lqd` 运气签到
- Telegram Bot 签到
- 自动签到脚本和 Telegram 汇报

## 功能

- 站点与 Telegram Bot 自动签到
- 签到失败重试
- 可选 Telegram 汇报
- 可选 systemd timer 定时任务
- 只读 Summary API，供客户端拉取结果
- 网页签到总览：项目统计、搜索、状态筛选、账号详情、深浅主题与手机布局

## 网页工作台

访问 `/` 或 `/dashboard/`，使用 `.env` 中的 `ADMIN_USER` / `ADMIN_PASS` 登录。
本机访问地址为 `https://ci.031216.xyz`。页面通过已认证的 `GET /api/v1/dashboard` 读取项目数据，
展示网站与全部已配置的 Telegram Bot；尚无执行记录的 Bot 显示「暂无记录」。
「刷新状态」只重新读取结果，不会触发签到。历史记录会标明日期，不计作今日签到。
项目详情底部提供「修改名称」，可设置最多 60 字的显示名称，或恢复默认；自定义名称保存在 `data/project_names.json`，不改变账号与签到行为。
项目详情底部提供「删除项目」，确认后移除本地签到配置与记录：网站项目会删除该站点全部账号；Telegram 项目仅移除对应机器人，保留 Telegram 登录账号。

页面参考 shadcn/ui `dashboard-01`，来源与设计约定见 `design/checkin-dashboard/design-contract.md`。
该目录同时保留可离线打开的设计稿；运行 `python3 design/checkin-dashboard/refresh-snapshot.py` 更新脱敏快照。

## 环境要求

- Node.js 18 或更高版本
- 可选：Python 3.11+ 和独立 Telegram 依赖，用于 Telegram Bot 签到及 GLaDOS Cloudflare 验证
- 可选：systemd 和 Nginx，用于服务器部署

## 快速开始

```bash
git clone https://github.com/zhangx16/Check-in-tools.git
cd Check-in-tools
cp .env.example .env
```

首次使用前请编辑 `.env`。需要 Summary API 时再启动：

```bash
node server.js
```

默认监听：

```text
http://127.0.0.1:22821
```

## Mobile / App API（只读摘要）

供 iOS PersonalToolbox 等客户端拉取签到总览，**不返回 Cookie / 密码**。

1. 在 `.env` 设置长随机 Token：

```env
APP_API_TOKEN=your-long-random-token
```

2. 请求摘要：

```bash
curl -sS -H "Authorization: Bearer $APP_API_TOKEN" \
  https://checkin.example.com/api/v1/summary | jq .
```

也支持 `X-API-Key: <token>`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/summary` | 聚合网站账号 + Telegram Bot 签到结果 |
| GET | `/api/v1/health` | Token/会话探测 |

`summary` 主要字段：

- `counts`：`total` / `success` / `already` / `failed` / `skipped` / `healthy`
- `providers[]`：按签到源汇总
- `items[]`：扁平列表（`status`、`message`、`checkedAt`、积分/连续/剩余天数等）

`status` 枚举：`success` | `already` | `failed` | `skipped` | `pending` | `unknown`。

## 配置

`.env.example` 包含所有常用配置项。

常用变量：

```env
HOST=127.0.0.1
PORT=22821
REQUEST_TIMEOUT_MS=20000
ADMIN_USER=admin
ADMIN_PASS=change-this-password
SESSION_SECRET=replace-with-a-long-random-string
DEFAULT_EMBYPULSE_BASE_URL=https://embypulse.example.com
DEFAULT_EMBYMB_BASE_URL=https://embymb.ichinosekotomi.com
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_DRY_RUN=false
CHECKIN_MAX_ATTEMPTS=3
CHECKIN_RETRY_DELAY_MS=5000
TELEGRAM_ALERT_ON_FAILURE=true
```

账号数据默认保存在 `data/` 下。也可以用这些变量覆盖路径：

```env
GLADOS_ACCOUNTS_FILE=
EMBYPULSE_ACCOUNTS_FILE=
EMBYMB_ACCOUNTS_FILE=
CHECKIN_PROJECT_ROOT=
```

## 数据安全

`data/` 和 `.env` 会包含 Cookie、站点密码、Telegram Bot Token、Telegram session 和 chat id。项目已通过 `.gitignore` 排除这些运行数据。

发布到 GitHub 前，请确认不要提交：

- `.env`
- `data/*.json`
- `data/telegram-chat-id.txt`
- `data/embykeeper/config.toml`
- `data/embykeeper/form.json`
- `data/embykeeper/runtime/*`
- `.venv-*`

## 自动签到

GLaDOS：

```bash
node scripts/daily_checkin_report.js
```

GLaDOS 返回 `reason=turnstile` 时，自动调用 `scripts/glados_cf_checkin.py` 完成新验证流程：通过配置的代理获取 challenge，以 `action=checkin`、`cdata=nonce` 调用 Peak，计算站点要求的 SHA-256 proof，等待至少 2.5 秒并在 challenge 有效期内提交。每次重试重新获取 challenge；验证码服务失败时不提交。复用 `data/peak_solver.json` 中的 API 密钥和本机认证代理，Cookie 仅发送给 GLaDOS。需要 `.venv-embykeeper/bin/python` 和 `requirements-telegram.txt` 中的依赖，可用 `GLADOS_CF_PYTHON` 指定 Python 路径。2026-11-15 两个账号均已实测签到成功，各获得 2 积分。

EmbyPulse：

```bash
node scripts/embypulse_daily_checkin.js
```

EmbyMB：

```bash
node scripts/embymb_daily_checkin.js
```

如果配置了 `TELEGRAM_BOT_TOKEN`，脚本会发送签到汇报。没有固定 `TELEGRAM_CHAT_ID` 时，脚本会尝试从 Bot 最近消息中识别并写入 `data/telegram-chat-id.txt`。

## Telegram Bot 签到

本机已添加 `@mdlrtgy_bot`、`@Freshippo_bot`、`@fengyuegeBOt`、`@bb_emby_bot` 的签到模板。
模板发送 `/start`，使用通用 worker 查找签到/打卡按钮，仅以明确的签到成功或今日已签回复确认完成。
已联网验证：MDL 通过「用户配置 → 每日签到」确认今日已签；Freshippo 确认今日已签；风月阁和步兵营收到签到成功回复。
MDL 需要先绑定账号，本机仅对已绑定账号执行；其他 Bot 未满足群组要求或没有签到权限时跳过。
可复用配置见 `templates/telegram_bot_templates.json`，将所需条目合并到 `data/embykeeper/form.json` 的 `botTemplates` 中。
`targetPhones` 为空时对所有启用签到的 Telegram 账号执行，可填写手机号限制执行账号。
仅运行这四个 Bot：

```bash
CHECKIN_BOT_USERNAMES=mdlrtgy_bot,Freshippo_bot,fengyuegeBOt,bb_emby_bot scripts/telegram_bot_checkin_once.sh
```

Cloudflare 验证签到：`@XGFree_bot`、`@liminalembybot` 与 `@Moonkkbot` 已接入 [Peak Turnstile API](https://peak.fo/docs)。在 `data/peak_solver.json` 配置 `{"apiKey": "pk_...", "proxy": "http://user:password@host:port"}`（权限 0600，文件已被 Git 忽略）。有代理时使用 `turnstiletask`，同一代理同时用于验证页、识别和结果提交；未配置代理时使用 `TurnstileTaskProxyLess`。发送给 Peak 的页面 URL 会去除查询和 fragment，不包含 Telegram initData 或签名链接；保留验证所需 sitekey、action 和 cdata。一次签到最多调用一次识别，验证服务失败不提交伪造答案，只有网站或 Bot 的明确回复才记作成功。XGFree 验证通过后使用返回的 Bot start 参数继续签到；Liminal 提交小程序授权；Moonkk 将 token 提交至对应 challenge 接口。验证码服务可能收费，已有余额不足、代理错误或服务故障会保留为失败。

2026-11-13 实测：XGFree（1329）签到成功，奖励 37 种子；Moonkk（4473）签到成功，奖励 6 月饼。Liminal 的接口和真实页面在 1329、4473 均返回 HTTP 403，尚未完成；本机配置 `pausedBots: ["liminalembybot"]` 暂缓该 Bot 的收费识别，确认服务端原因后清空此列表可恢复。

本机认证 HTTP 代理由 `peak-proxy.service` 管理，监听 TCP 39901；配置位于 `/etc/peak-proxy.conf`，凭据同步到上述私有配置。使用专用系统用户运行，未认证连接会被拒绝，仅开放 CONNECT 443。查看状态：`systemctl status peak-proxy`。远端 Alpine 服务器的测试代理已移除自动启动，当前使用本机出口。

终点站（`@EmbyPublicBot`）使用 `/cancel`、`/checkin`，需要在 30 秒内看图选择物体，每天仅一次机会。已独立适配 [Embykeeper visual 协议](https://github.com/emby-keeper/emby-keeper/blob/main/embykeeper/telegram/link.py)，无需安装 Embykeeper。此功能会通过当前 Telegram 账号向 `@embykeeper_auth_bot` 发送 `/auth visual`，并将验证码图片和候选项发给该 Bot 的 `/visual` 服务，服务可能要求账号权限；不会发送其他聊天内容、密码或 session。首次启用前必须获得账号所有者授权，在 `data/telegram_visual.json` 写入 `{"enabled": true}`；默认关闭，关闭时不发起签到或远端请求。仅接受候选项中的精确答案，并等待 Bot 明确成功回复；每账号每天（UTC）提交前记账，超时或失败不自动重试，记录保存在 `data/telegram_visual_attempts/`。无历史对话的账号会跳过。

Lewa（`@Lewa_user_bot`）签到后检查「积分商城」余额，达到 3000 积分时兑换一张月卡。
OkEmby（`@okemby_bot`）签到后走「用户功能 → 兑换商店 → 续期可用天数」，满 60 OK 币时按菜单汇率计算可兑换天数并输入。
OkEmby 每次成功续费后至少间隔七天；Lewa 每天最多自动兑换一张月卡。沿用各 Bot 的 `targetPhones` 账号范围。
兑换记录保存在 `data/telegram_renewals/`，提交前记账；结果不明确时暂停重复兑换，需核对后处理记录。

宸澄 Ccbot（`@wybtcok_bot`）发送 `/start`，点击「✅ 每日签到」，等待明确签到成功或今日已签回复。
未满足频道关注和群聊加入要求时跳过。

MICU Cloud Media（`@micu_user_bot`）发送 `/start` 打开菜单，点击「🎯 签到」。
遇到加减法数字题时，worker 计算结果并点击对应答案按钮；答错重新出题时会处理新题。
以「签到成功」确认完成，以「您今天已经签到过了」等明确回复判断今日已签；支持会员米币奖励。
在 `data/embykeeper/form.json` 添加同名模板，`targetPhones` 为空时对所有启用的 Telegram 签到账号执行。

Telegram Bot 签到使用本项目自己的 worker、Kurigram 客户端和本地 OCR，不安装或调用 Emby Keeper。为兼容历史部署，保留原虚拟环境与数据目录名称：

```bash
python3 -m venv .venv-embykeeper
. .venv-embykeeper/bin/activate
pip install -r requirements-telegram.txt
```

在 `data/embykeeper/form.json` 中填写 Telegram 账号和 Bot 模板后，可先在终端执行首次登录：

```bash
scripts/telegram_relogin.py <手机号尾号>
```

自定义 Telegram worker：

```bash
scripts/telegram_bot_checkin_once.sh
```

Foam（`@lilisiebot`）使用 `/start` 打开菜单，由 worker 点击「✅ 每日签到」。
Bot 模板的成功关键词设为 `签到成功`，已签到关键词包含 `今天已签到`；
不要用「积分」判断成功，以免将积分菜单误判为签到结果。通过 `targetPhones` 指定已满足 Bot 群组要求的账号。
worker 为 Foam 预留 20 秒等待独立的签到结果消息。

稳健 Emby（`@wenjian_emby_bot`）使用 `/start` 打开菜单，由 worker 点击「🎯 签到」。
HSUYS（`@hsuys_bot`）也已加入 Bot 模板：worker 发送 `/start`，查找签到按钮并等待签到结果。
这两个 Bot 的模板仅以明确的签到成功或已签到回复判定完成。
用户面板如果带有签到按钮，即使显示「未注册 / 未绑定」，worker 仍会点击签到；没有账号的 Telegram 号也可以参与签到。
只有明确拒绝（无权、需先加群等）才会跳过并写入 skip cache。
稳健杂货铺（`@libhsulife`）是群组，模板设置 `isChat: true`、`commands: ["就位"]`，
通过 `targetPhones` 选择参与签到的账号。群签到仅接受 Bot 对本次命令的直接回复，
避免把其他成员的签到结果误记为本账号成功。上述三个目标的回复等待时间均为 20 秒。

ZZMEB（`@zzmeb_bot`）同时走两种签到：`/start` 后点击「🎯 签到」，以及打开 MiniApp 面板（`t.me/zzmeb_bot/miniapp`）调用用户中心签到接口。两种方式各自计奖，worker 会把两边结果写进同一条记录。

Nayovo（`@OicOvo_bot`）使用 `/start` 打开菜单，由 worker 点击「🎯 签到」，交互与非越相同。
宸澄 Ccbot（`@ccwuser_bot`）使用 `/start` 后打开「🎯 签到」小程序，通过 Telegram 授权登录用户中心。worker 先读取当天签到状态，已签到时不重复提交；可签到时提交签到并再次核对服务器状态。

月饼（`@Moonkkbot`）使用 `/start` 打开用户面板，签到按钮会打开 EmbyGuard 小程序；
worker 读取 WebApp 链接，用 Telegram WebView 的 `init_data` 调用小程序签到接口。
该 Bot 要求账号已加入受管群；当前通过 `targetPhones` 指定可用账号。

Mirai（`@miraiembytest_bot`）直接发送 `/checkin`，以「签到成功」或「今日已签到」判定结果。
未加入配置群组的账号会被跳过。
ShrekPublic（`@shrekpublic_bot`）使用 `/start` 打开菜单，由 worker 点击「🎯 签到」。
茶包（`@tbagemby_bot`）同样使用 `/start` 后点击「🎯 签到」。未加入群组或频道的账号会被跳过。
Gary's Club（`@garysclubsubbot`）直接发送 `/checkin` 每日打卡领积分。
成功回复含「签到打卡成功」，已签到回复含「您今天已经签到过了」。
`/start` 会要求加入 `@garysclub` 和 `@roctech` 才能看订阅卡，worker 会忽略加群验证卡片，用 `/checkin` 完成打卡。
ChaPanda（`@ChaPanda3_bot`）使用 `/start` 打开菜单，由 worker 点击「🎯 签到」。
成功回复含「签到成功」或 callback「✔️ Done!」，已签到回复含「您今天已经签到过了」。未加入频道/群组的账号会被跳过。
癫影 MADOW（`@madowchat_bot`）发送 `/lqd` 做运气签到。
已签到回复「今日已签到。」；成功回复含运气结果（大奖 / 平手 / 空签 / 倒霉签）。当前用 `targetPhones` 指定已绑定门户的账号。

## 服务器部署

`deploy/` 下提供 systemd 和 Nginx 示例模板，默认假设项目部署到：

```text
/opt/glados-checkin-web
```

根据你的服务器路径、运行用户、域名和 TLS 配置修改后再安装。

示例：

```bash
sudo cp deploy/glados-checkin-web.service /etc/systemd/system/
sudo cp deploy/glados-checkin-daily.service /etc/systemd/system/
sudo cp deploy/glados-checkin-daily.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now glados-checkin-web.service
sudo systemctl enable --now glados-checkin-daily.timer
```

Nginx 示例见 `deploy/nginx.example.conf`。

## 开发检查

```bash
npm run check
```

这个命令会对 Node.js 入口和自动签到脚本做语法检查。

## 免责声明

本项目只提供自托管账号管理和签到自动化工具。请遵守相关站点的服务条款，并自行保护账号 Cookie、密码和 Telegram 凭据。

### VPSNAT 纳泰云签到

新增 provider `vpsnat`，默认站点 https://www.vpsnat.com。账号保存在 Git 忽略的 `data/vpsnat_accounts.json`，支持用户名密码及浏览器会话 `token`、`refreshToken`。启用 Turnstile 的站点需要先在浏览器完成登录，再从 Local Storage 导入这两个值（可通过现有账号创建/更新 API 提交）。会话过期时自动使用 refreshToken 续期并保存轮换后的令牌；失效后需重新导入。不要提交真实密码或令牌。

签到请求仅领取每日奖励，记录积分和 CPU/内存/磁盘/流量资源奖励，不兑换资源。今日已签到时跳过；站点关闭签到或要求有效实例时明确报告原因。

每日脚本：`node scripts/vpsnat_daily_checkin.js`。部署模板：`deploy/vpsnat-checkin-daily.service` 和 `.timer`，北京时间 10:13 运行，纳入 10:14 网站汇总。单独运行每日脚本沿用现有 Telegram 报告设置。

## 这只猫用户中心签到

账号保存在 `data/zzcat_accounts.json`，使用 Telegram 登录网站后获得的 `qp_session` Cookie。
脚本先读取 `/api/miniapp/bootstrap/core` 的 `profile.checkedInToday`；未签时调用 `POST /api/user/checkin`，记录猫币奖励与余额。
仅接受明确的 `awardedNow` 结果，重复运行已签时不发起签到 POST；若会话失效会明确报告需要重新登录，不自动操作 Telegram。

```bash
node scripts/zzcat_daily_checkin.js
```

本机定时任务为 `zzcat-checkin-daily.timer`，每天北京时间 10:15 执行。网站签到与 Telegram Bot 签到分别显示。

## Bot 签到目录（独立实现）

参考 [Emby Keeper README](https://github.com/emby-keeper/emby-keeper/blob/main/README.md) 的签到模块元数据，
整理命令、成功/已签关键词、菜单入口与验证码参数，使用本项目自己的 worker 执行；不安装、导入或调用 Emby Keeper。
网页「添加机器人」可搜索并添加可独立适配的 Bot。目录包含 124 个非群聊模块，其中 87 个支持通用命令/菜单签到，
37 个涉及专用交互或外部认证，明确标为尚未适配，不会按通用方案冒充支持。实际签到还取决于账号注册、群组要求及验证码。
同一 Bot 用户名只添加一次；已有自定义流程优先保留。新增目录配置默认只对已有聊天会话的账号运行。

- `templates/telegram_bot_catalog.json`：带来源和能力标记的静态目录。
- `scripts/build_bot_catalog.py <上游源码中的checkiner目录>`：通过 AST 提取公开配置，不执行上游代码。
- `scripts/import_bot_catalog.py`：只读扫描已启用账号的现有 Telegram 会话，添加匹配的可用 Bot，并写入 targetPhones。
- `scripts/telegram_captcha.py`：验证码图片本地识别，校验答案字符和长度。可选远端物体识别由 `scripts/telegram_visual.py` 提供，需单独授权启用。
- Telegram API ID / Hash 在本地 form 的账号项或 `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` 中配置；原本机凭据已迁移。
- 历史 `embykeeper_run_once.sh` 只是当前 worker 的兼容入口；每日只启用 `telegram-bot-checkin-daily.timer`，避免两套任务重复签到。

## Emby 自动保活

网页侧栏「Emby 自动保活」支持添加服务器地址、可选端口、账号密码、执行间隔（1–365 天）、
每次随机观看范围（最短/最长均为 30–7200 秒）、客户端名称、设备名称、版本以及备注。默认客户端上报标识为 `SenPlayer / iPhone`，
同一账号保持固定设备 ID；可以在配置中修改名称。密码保存在本机 `data/emby_keepalive_accounts.json`，权限 0600，接口不返回密码。

流程参考上游的认证、媒体选择、PlaybackInfo、持续读取媒体流与进度上报方式，在本项目独立实现：
实际读取视频（约 64 KiB/s 限速、不落盘），按真实时间上报进度，结束时发送 Stopped，并查询 LastPlayedDate。
只有服务器确认新的观看记录后才记为成功并推进下次日期；未确认、权限不足、无可播视频和连接失败会显示具体原因。
这只能证明服务器接受了播放记录，各站点的保号规则仍需自行填写；备注不会自动解析为执行周期。

- 每 15 分钟检查到期账号，默认每 7 天随机观看 300–1000 秒；失败后至少间隔 1 小时重试。
- 网页支持测试连接、立即保活、编辑、暂停/启用定时、删除账号配置；播放中禁止编辑/删除，避免任务竞争。
- 后台任务和手动任务使用同一账号锁，配置更新采用原子写入与跨进程写锁。
- 页面显示当前进度、上次观看时间与实际时长、累计验证观看时长、下次计划与执行结果。
- 地址保留输入路径；如部署在 `/emby` 反向代理路径下，请在服务器地址中填写该路径。

```bash
node scripts/emby_keepalive.js                      # 执行到期任务
node scripts/emby_keepalive.js --account <账号ID>   # 单次执行
```

部署 `deploy/emby-keepalive.service` 与 `.timer` 后启用 `emby-keepalive.timer`。
自动保活不依赖 Emby Keeper 软件，不启用上游的抢注、群发言、外部认证或模拟其他账号功能。

随机时长在任务启动时只抽取一次，本次目标显示在运行进度中并随最终结果保存。时长缺失的 STRM 远程媒体可尝试播放；媒体流跳转到 CDN 时不会携带 Emby 登录请求头。连续 30 秒无新媒体数据会停止并记录失败。

媒体连接异常时参考上游 `Emby.play()` 的按字节续传方式，最多重新连接两次；续传必须返回 206 且 Content-Range 起点与已读取字节数一致，否则判为失败。媒体首字节等待 60 秒，登录/媒体信息请求每次等待 30 秒，安全的启动请求遇到网络超时可重试一次；播放开始/进度/停止上报不自动重复发送。

客户端与设备字段仅为 HTTP 请求中上报的信息，本程序没有运行 SenPlayer 或 iOS，也没有解码视频画面。这些字段及观看记录成功不代表管理员无法识别自动化；不得将它描述为真实手机身份认证。

Doubon（`@DoubonBot`）通过 `/start` 打开菜单并点击「🎯 签到」，以明确签到成功回复或今日已签提示确认结果；只对已有 Bot 会话的启用账号执行。

宸宇 Emby（`@ChenyuEmby_Bot`）发送 `/start` 后点击「🎯 签到」，只接受明确的成功或今日已签回复；不触发续期、兑换或白名单功能。已有会话的启用账号会自动纳入每日签到。

Emby 保活任务会保存视频 ID、媒体源、播放时间和已读取字节位置，下次优先从上次进度继续。视频被移除、已看完或剩余时长不足本次任务时重新选片。旧版本未保存这些字段的历史记录，从下一次运行开始建立续播记录。本次观看时长与视频累计播放进度分别计算，失败不会增加成功观看统计。

### 练习生的日常（thxnk.cc）

账号保存于本机 `data/thxnk_accounts.json`（受 Git 忽略）。使用账号密码登录，携带会话与 CSRF Token 调用每日签到接口；服务端按签到日期去重。网站金额以最小单位返回，面板按 100:1 显示为「只因」。运行 `node scripts/thxnk_daily_checkin.js`，或安装 `deploy/thxnk-checkin-daily.service`、`.timer`，每日北京时间 10:13 执行。结果纳入网站汇总和看板。

ZZMEB（`@zzmeb_bot`）分别执行 `/start` →「🎯 签到」→ 算术题选项及 `/start` →「MINIAPP」→ 小程序签到。当前小程序入口为 `https://user.090911.xyz/mini`。两条路径均需明确成功或已签结果，分别保存结果；其中一条失败会提示具体原因，另一条仍继续执行。

## WorkBuddy 签到

工作台左侧提供独立 WorkBuddy 模块。默认使用官方网页登录授权，由服务器获取并保存登录凭据，无需安装 CLI 或粘贴令牌；高级入口仍支持明文凭据 JSON 或旧 WorkBuddy2API 单账号导出格式。账号详情可以更新凭据、查询状态、手动签到；后台任务运行时可以关闭详情页，稍后重新打开查看结果。凭据不会通过详情接口回显，不会传入子进程命令行。

模块复用账号记录、项目汇总和每日报告。签到通过适配器调用上游 `run_daily`，包含每日签到与成长中心；上游源码和 MIT 许可位于 `vendor/workbuddy-auto-signin/`，固定版本见 `REVISION`。Python 3 标准库即可执行。相同 uid 的手动与定时执行由进程锁互斥。认证失败不盲目重试；签到成功但成长中心失败会显示异常，避免错误归为全部成功。累计签到积分不是可用账户余额。

- 账号数据：`data/workbuddy_accounts.json`，文件权限 600。
- 手动任务：`POST /api/v1/workbuddy/accounts/:id/run`，请求体 `{"action":"auto"}` 或 `{"action":"status"}`；返回 202。
- 任务查询：`GET /api/v1/workbuddy/accounts/:id/job`。以上接口沿用工作台登录 / App API 认证。
- 凭据导入：现有 `POST /api/v1/accounts`，provider 为 `workbuddy`，字段为 `workbuddySession`；更新使用对应 PUT 接口。
- 每日任务：`scripts/workbuddy_daily_checkin.js`；定时模板为 `deploy/workbuddy-checkin-daily.service` 和 `.timer`，每天北京时间 00:05。复用现有每日报告配置。
- Windows/macOS 的设备绑定加密凭据不支持在此 Linux 服务解密；需要明文登录态。支持导入 `auth.refreshToken`、`expiresAt`、`refreshExpiresAt`，签到或查状态时会在 accessToken 到期前约 1 天刷新（覆盖每日任务间隔），或遇到 401 后刷新重试一次；轮换后的令牌先原子保存，再执行签到。刷新拒绝或结果未知时停止自动重试并提示重新登录。缺少 refreshToken、刷新令牌到期或被撤销时仍需人工登录。Qoder 未包含在此模块。

### Linux 重新登录与自动续期

运行 `codebuddy`，使用交互命令 `/logout`、`/login`，选择国内站并用原签到账号完成浏览器登录。登录后在工作台账号详情更新完整 JSON，或在服务器执行：

```bash
node scripts/import_workbuddy_auth.js "$HOME/.local/share/CodeBuddyExtension/Data/Public/auth/Tencent-Cloud.coding-copilot.info"
```

如 CLI 使用自定义 XDG 目录，将参数替换为实际文件路径。导入程序要求包含明文 refreshToken，并仅更新 uid 匹配的现有账号，不打印凭据。自动续期不需要持续运行 CLI；每日任务或手动查询会触发到期检查。不支持通过已过期的 accessToken 推导刷新令牌。

### WorkBuddy 独立面板与官方登录授权

左侧 WorkBuddy 独立管理账号，不再归入网站签到。默认添加流程：填写名称 → 官方登录并添加 → 打开官方授权页 → 完成登录 → 服务器自动保存访问令牌、刷新令牌并执行首轮签到与成长任务。无需在网页粘贴令牌或安装 CLI。每个账号独立保存，UID 重复会拒绝新增；重新授权会核对原账号 UID。手动 JSON 导入和 Linux 文件导入仍作为备用方式。

面板显示每日签到、Buddy 旅行与礼物、成长任务接单与领奖、断登补签、连登奖励兑换、盲盒抽奖、能量开 Buddy 盲盒、成长能量，并展示服务端返回的具体成长子任务。只处理满足条件的奖励，未解锁、旅行中或缺少补登卡不视为已完成。每日 00:05 任务保留；新增 workbuddy-growth-poll.timer，每小时第 20 分钟执行完整幂等检查，及时领回旅行礼物、补派 Buddy 和补跑错过的签到。轮询不发送常规 Telegram 通知。

授权 API：POST /api/v1/workbuddy/logins（名称和可选 accountId）；GET /api/v1/workbuddy/logins/:id 查询；DELETE 取消。登录链接有效期 5 分钟，只有经过工作台认证的用户可操作，访问/刷新令牌不通过接口回显。GET /api/v1/workbuddy/accounts 仅返回 WorkBuddy 账号的脱敏数据。

### Production refactor PR1: HTTP and security

`server.js` starts `lib/app.js`; native HTTP adapters are in `routes/`, with shared authentication, response, static-file and account-write helpers under `lib/http/`. The pre-refactor route inventory is in `docs/route-inventory.md`. Provider requests and check-in judgments are unchanged.

Before deploying this branch, set `ADMIN_PASS` and `SESSION_SECRET` to non-default values of at least 16 characters. Optional `APP_API_TOKEN` (or legacy `CHECKIN_API_TOKEN`) and `APP_API_TOKEN_SECONDARY` must also be at least 16 characters when set. The secondary token allows rotation without disconnecting existing clients. Startup refuses invalid settings; no credentials are generated or overwritten. Existing cookies require a fresh login after upgrade: new signed cookies expire after 30 days. Five failed logins per socket IP block further attempts until the original ten-minute window expires; successful logins do not clear failures. Nginx deployments share a rate-limit bucket unless separate client connections reach Node; forwarded IP headers are deliberately not trusted.

Account details expose `hasPassword` instead of passwords. Empty password updates preserve the stored password. Exports omit passwords and cookies unless an authenticated web session explicitly uses `/api/accounts/export?includeSecrets=1`; sensitive exports and write requests are audited in `data/audit.log.jsonl` (mode 600). Request logs include a request ID, response status and duration, never request bodies, credentials, or query strings. JSON request bodies are limited to 256 KiB; account imports allow 1 MiB.

Validation: `npm run check && npm test`. HTTP tests run in temporary projects with synthetic credentials and exercise health, dashboard/login HTML, authenticated APIs, expiration, rate limiting, redacted export, audit and Telegram catalog TOML persistence. No live account files are used. Rollback: revert this PR; the JSON account format is unchanged, and users log in again. No deployment/timer changes are part of PR1.

### Production refactor PR2: JSON transactions and summary cache

JSON remains the only/default backend; no database migration or dual-write is needed at the present data size. `updateAccounts`/`updateProviderAccounts` read and update under a shared cross-process directory lock; writes use exclusive temporary files, fsync and rename with mode 600. `writeAccounts`/`writeProviderAccounts` are explicit snapshot replacements; concurrent callers must use transaction APIs. Scheduled result merges preserve edits and deletions. WorkBuddy refresh/job writes use the same account lock.

Summary responses cache for 30 seconds, invalidate on source-file changes, and return independent copies to callers. Icon lookups return an existing file or null immediately; downloads run later with concurrency four and retry cooldown. `ICON_FETCH_ENABLED=0` disables background discovery for offline deployments. `CHECKIN_STORE_RAW=1` retains check-in raw responses for troubleshooting; the default removes `lastCheckin.raw` while projecting the fields used by the existing UI. Removing raw is not an account schema migration; reverting cannot reconstruct previously discarded raw diagnostics.

Telegram subprocess output retains at most 64 KiB; runtime is capped at ten minutes, with termination escalation. A shared `data/embykeeper/run.lock` excludes overlapping web/timer workers; a web-owned lock remains held until the child actually closes. Existing Python entry points remain. The production venv is untouched.

Validation adds cross-process transaction, result-merge, raw projection, cache expiration/copy isolation, deferred icon download and offline dashboard tests. Fifty local dashboard requests measured p95 7.91 ms in the isolated fixture (this is not a production load guarantee). Rollback: revert PR2 after stopping workers; JSON remains readable by PR1. No SQLite/Redis service or production-data rewrite is introduced.

### Production refactor PR3: domain services and HTTP contracts

`domain/` now owns account validation, check-in orchestration, Telegram persistence, project names, status aggregation and summary/dashboard projection. HTTP adapters retain authentication, body parsing and DTO mapping. Provider request implementations are unchanged; unknown provider keys now fail explicitly instead of falling back to GLaDOS. Account creation/update checks duplicate provider usernames or keyed cookie fingerprints inside the write transaction. Notes are limited to 4,000 characters.

`partial` is a shared project state for successful/already-completed accounts mixed with skipped accounts. Summary and dashboard use the same project projection, including configured bots without results and hiding deleted bots. Individual check-in success/failure judgments are unchanged. WorkBuddy batch operations return 202 and job metadata while queued; no synthetic failed check-in is stored. Worker completion merges remain transactional.

Telegram form responses expose `hasSession`; session strings stay on the server. Blank form session updates retain the existing session (`clearSession: true` explicitly clears it). The legacy TOML editor uses indexed session placeholders that restore stored values on save. `CHECKIN_DATA_DIR` can isolate test/deployment data; default remains `data/`.

`npm test` now discovers all Node tests and runs Telegram Python tests when `.venv-embykeeper/bin/python` exists. Validation: 69 Node tests and 49 Telegram Python tests passed; native Node coverage across `domain/*.js` and `routes/*.js` was 94.77% lines / 76.22% branches in the HTTP/domain suite. The optional Python runtime was reused read-only for tests; no production venv or account data was rewritten. Rollback: revert PR3; account JSON stays compatible, with a fresh web login if also reverting PR1.
