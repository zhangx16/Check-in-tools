# 签到工作台设计约定

用于查看本机全部签到项目、筛选需要关注的任务、展开账号最近执行结果。

## 参考与源码

- 主参考：https://ui.shadcn.com/view/new-york-v4/dashboard-01 。用户于 2026-10-22 选择候选 2。
- 沿用参考的侧栏外壳与 inset 主内容区域、原始卡片 markup、CSS 工具类、黑白灰主题、线条图标、圆角与浅渐变卡片。
- `reference-0.css` 至 `reference-4.css` 是该页面原始编译样式的本地副本。移除外部资源 URL，页面离线不发请求。
- 原始 card / badge / button / row markup 归档于 `reference-components.json`。许可见 `LICENSE-shadcn.md`。
- 在此基础上以 `dashboard-patches.css` 适配签到内容；未引入前端框架或构建流程。
- 用户提供域名后追加授权部署与真实数据接入。静态设计稿与生产网页独立：设计稿加载脱敏 `snapshot.js`，生产页面使用已认证接口，不发布快照。

## 内容结构

1. 左侧来源导航：全部项目、网站、Telegram、需要关注。
2. 项目标题与刷新：说明展示的是最近实际执行记录。
3. 四张指标卡：总项目数、最近记录正常、需要关注、暂无记录；均根据项目数据计算。
4. 执行概况：使用参考图表卡片的圆角与边框，以实际项目状态分布替代原例子的商业时间序列；没有虚构历史曲线。
5. 项目列表：搜索、来源 / 状态筛选、分页、最近执行时间。点击项目展开账号详情。
6. 登录、空搜索、详情、深浅主题、手机菜单均有完整可触达状态。

## 样式变量与来源

原始样式是设计依据，不将其改写成独立新系统。

| 可调项 | 变量 | 来源 |
| --- | --- | --- |
| 间距 | `--gap: 16px`、原始 `--spacing: .25rem` | 参考工具类与产品布局 |
| 正文 | `--fs: 14px` | 参考 text-sm；中文系统字体回退 |
| 圆角 | `--radius: .625rem` | 原始产品 token；派生 6 / 8 / 14 px 与 pill |
| 前景 / 底色 | `--foreground` / `--background` | 参考 light / dark token |
| 次级文字 | `--muted-foreground` | light 从参考 lab(48.496%) 降至 lab(45%)，确保浅灰底对比度达标；dark 保持参考 |
| 边框 | `--border` | 参考 token |
| 内容宽度 | `--measure: 68ch` | 为后续长文本预留；当前表格不用该变量 |
| 动效 | `--dur: 160ms` / `--ease` | 局部交互预留；尊重 reduced-motion |

没有单个原始属性可映射的 hue / ink / surface / line 标量、ratio、edge、shadow、room 不绑定；不为了凑齐滑杆重写源 CSS。

## 固定决定与审计例外

- 保留所选参考的多级圆角、小阴影、浅色卡片渐变与响应式字号；这些属于参考本身，不按通用审计的两个圆角 / 五个字号 / 无渐变限制移除。
- 色彩保持黑白灰；状态通过图标与文字区分，不依赖颜色。
- 中文回退使用 PingFang SC / WenQuanYi Zen Hei / Microsoft YaHei，替代参考仅覆盖拉丁字母的 Geist 网络字体。离线不下载字体。
- 历史「已签」显示为「当日已签」，并标注历史记录；不把最近成功当作今日成功。
- 部分账号跳过、部分成功的项目显示「需要关注」。
- 站点只展示已有配置账号的 provider；EmbyPulse 当前没有账号，因此不凭空占一项。
- 电话在设计稿与页面展示中脱敏；生产接口沿用现有会话认证。

## 样本与数据

没有虚构项目、签到奖励、历史趋势或商业指标。设计稿为生成时的本机数据快照，时间写在页面中；它不会自动同步，不触发签到。
`refresh-snapshot.py` 仅复制允许的展示字段，不复制密码、Cookie、session、API 凭据或原始服务端 payload。

## 稳定锚点

`sidebar/brand`、`sidebar/navigation`、`header`、`overview/title`、`metrics`、
`metrics/projects`、`metrics/healthy`、`metrics/attention`、`metrics/pending`、
`overview/distribution`、`projects`、`projects/filters`、`projects/row-<project-id>`、
`project-details`、`project-details/account-<n>`、`login`。

## 交付与验证

- 静态稿：本目录 `index.html` + `snapshot.js` + `dashboard-runtime.js` + `dashboard-patches.css` + 原始 CSS。
- 更新快照：从项目根运行 `python3 design/checkin-dashboard/refresh-snapshot.py`。
- 生产页面：`public/dashboard/`。从项目根运行 `node scripts/build_dashboard.js` 同步设计稿到生产页面；不包含静态快照或审阅工具。
- 生产数据接口：`GET /api/v1/dashboard`；复用 Summary 展示字段，为无记录模板补全项目，不改变旧 Summary API。
- 已检查宽度：375、767、768、1100、1101、1440 px，无整页横向溢出。
- 检查状态：默认、详情、空结果、登录、手机侧栏、桌面收起；light / dark。审计结果见 `qa-states.json`。
- 可访问性：修复灰底文字对比度；原生 dialog 支持焦点限制、Esc 关闭与关闭后返回触发按钮；登录框防止未登录时关闭；控件保留可见键盘焦点；项目标题点击目标至少 28px 高。
- 36 个状态组合均无已测文字对比度失败；tablet 下因滚动区域而标记 approximate 的文本未逐条截图证明其背景，实际同类表格在其他宽度已通过。键盘 Tab 的首个控件显示 solid 焦点环；Enter 可开详情，Esc 关闭并恢复原按钮焦点。
- 浏览器端注入官方 draft-kit，绑定 gap / radius 验证并运行审计；交付目录与生产网页没有残留审阅工具、选择记录或滑杆覆盖。
- 刻意不包含：网页触发签到、账号配置新增或编辑、虚构时间序列、定时任务改动。

## 2026-10-22 功能迭代：删除项目

用户要求新增删除选项。项目详情底部增加「删除项目」，切换到同一弹窗的确认状态，明确网站全部账号或对应 Bot 配置的删除范围。取消不发送请求；失败保留弹窗并可重试；成功重新读取项目并更新统计与分页。静态稿只模拟本地移除。生产后端保留其他 Bot 的 buttonSequence 等原始字段，并允许删除最后一个 Bot 后保持空列表。删除接口在临时项目副本中测试，不删除本机真实项目。

## 2026-10-22 功能迭代：自定义名称

项目详情底部增加「修改名称」。同一弹窗内提供单行输入、保存、取消、恢复默认；名称最多 60 字。显示别名单独保存在 data/project_names.json，网站和 Telegram 项目都支持；删除项目同时清理别名。保存失败保持输入和弹窗供重试，名称以文本显示，不按 HTML 渲染。生产总览和 Summary 项目标题均应用别名；静态稿仅模拟修改。

## Bot 目录入口

项目列表标题区增加「添加机器人」按钮，详情弹窗内复用搜索输入、选择列表和现有按钮样式。目录明确区分已添加、通用流程可用和需要专用交互的尚未适配项目。不启用上游引擎，运行时使用独立 Telegram 客户端。

## Emby 保活模块

新增左侧导航「Emby 自动保活」，继承当前主题、字体、统计卡片、按钮、表单和 dialog。账号记录以纵向列表展示，包含设定时长、上次实际观看时长、上次观看时间、下次计划、备注与执行状态。表单包含服务器地址/端口、账号/密码、间隔/时长、客户端/设备/版本、备注与自动开关。支持空列表、新增/编辑/删除、测试连接、手动播放、运行进度、错误和暂停状态。凭据不作为设计数据或截图内容，测试采用临时假账号。播放采用独立后端，默认原生播放器 SenPlayer / iPhone 标识与稳定设备 ID；观看记录必须经过真实流量和服务器 LastPlayedDate 验证。

保活模块验证：375 / 768 / 1440 px 无页面横向溢出；新增/编辑/删除、运行与完成状态、密码隐藏通过浏览器验证。真实 FaEmby 已保存并验证登录与媒体库/流读取可用；Sessions/Playing 返回 HTTP 500，界面保留失败而非写入虚构的观看时间。25 项 Node 测试（含真实 30 秒本机模拟流）与 13 项 Python 测试通过。

## 随机观看范围

观看时长改为最短 / 最长秒数输入，默认 300–1000 秒。任务启动时随机抽取整数，运行中显示目标时长与已播放秒数，实际完成秒数与随机目标均保存。用户指定 BB Emby 为完整测试目标，Potdot 测试已停止并发送 Stopped，不计为完整成功。

## WorkBuddy 独立模块（2026-11-17）

沿用现有 Emby 保活页与总览的设计：侧栏 keepalive-nav、四个 emby-stat 统计、账号 emby-account、emby-facts 信息列表、统一弹窗与按钮。继续使用既有 --border、--radius、--background、--foreground 与 muted token，不另设色板、字体或阴影。WorkBuddy 在概览使用独立 kind，不计入网站筛选；专属入口展示按账号计算的今日签到、关注、自动续期统计。单账号与空状态、筛选无结果、凭据表单、错误、后台执行、删除确认均纳入检查。多账号按同一列表组件逐个呈现，不引入额外卡片网格。锚点：sidebar/workbuddy、workbuddy/module、workbuddy/accounts、workbuddy/account。

网页授权为默认添加和更新方式，手动导入折叠为备用入口。官方授权链接仅在会话有效时展示；取消、错误、等待和成功均为独立状态，令牌不回显。任务列表复用账号卡片内的行与 badge，提供八类任务与可展开子任务。实际检查宽度为 1440px、390px；桌面/移动端同一组件，手机按钮保留可读文字与至少 40px 高度。
