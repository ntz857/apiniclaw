# Changelog

本项目变更日志采用「按版本记录」方式，遵循 Keep a Changelog 风格。

## [Unreleased]

## [0.3.4] - 2026-08-06

### Added
- **196 个中文智能体预设**（awesome-openclaw-agents 全量本地化）：统一 SOUL 结构（身份 / 人设 / 能力 / 工作原则 / 工作语言 / 示例），并同步 zh-CN / en i18n。
- 智能体创建支持预设挑选抽屉；创建后可一键应用 skills allowlist，并自动安装缺失的 workspace skills。
- 聊天输入框草稿按会话隔离（切换会话不再串草稿）。
- 技能页增强：未就绪修复面板、安装态与详情交互改进。
- 翻译/重建脚本：`scripts/translate-awesome-souls.mjs`、`scripts/build-presets-from-zh.mjs`（DeepSeek 官方 API / Reasonix 配置）。

### Changed
- **产品更名为 ApiniClaw**：安装包、图标、关于页与文案统一品牌。
- 官方域名切换至 `apiniclaw.com`（API / 文档 / 更新 CDN / 官网）。
- electron-builder 产物名改为 `ApiniClaw-*`；CI 与 release 校验脚本同步适配。
- 打包排除 `dist` / `dist-apini*`，避免历史 win-unpacked 递归打进 asar。

### Fixed
- 实时聊天 WebSocket 握手兼容 OpenClaw **2026.7.x**：`connect` 协议协商由仅 `3` 扩展为 `minProtocol=3` / `maxProtocol=4`，修复对接新版 Gateway 时的 `protocol mismatch`（code 1002）与「未连接」状态。
- 设备签名仍使用 Gateway 的 `buildDeviceAuthPayloadV3` 格式；线协议版本与签名 payload 前缀解耦。
- 补充 `operator.talk.secrets` 等 operator scope，减少新版 Gateway 下部分 RPC 缺 scope 失败。
- 握手失败重试：识别 `gateway token mismatch` / `token_mismatch`（不仅是 `TOKEN_MISMATCH`），自动清除过期 deviceToken 后重连。
- 定时任务 `cron.add` / `cron.update` 对齐 OpenClaw 2026.7 schema：`agentId` 改到任务顶层；`payload` 仅保留 `kind`+`message`；补齐必填 `sessionTarget`/`wakeMode`。
- 渠道保存时自动安装/启用对应 channel 插件（如飞书 `@openclaw/feishu`），避免「绑定成功但聊天无响应」（Gateway `no-channel-owner`）。
- 配对审批改用系统/npm 全局 openclaw（与 Gateway 同版本），避免内置 2026.3 读 2026.7 配置报 `Config invalid`；`--notify` 改为尽力而为，不因飞书不支持通知而把审批标成失败。
- **统一 OpenClaw 运行时解析**（`openclaw-resolve`）：Gateway 启动、Agent CLI、配对、渠道插件安装、备份、PATH wrapper 一律优先系统/npm openclaw，其次 `~/.apiniclaw/gateway`，最后才回退安装包内置版本，消除 2026.3 / 2026.7 双轨。
- **聊天消息串会话**：`handleChatEvent` 增加 `sessionKey`/`runId` 隔离；其它会话（如飞书）的流式事件不再写入当前打开的聊天；禁止 agent 事件用当前 session 回填 sessionKey；同步 messageCache。
- **聊天内本地文件链接可点击打开**：Markdown 链接原先仅有 hover、点击走 `openExternal` 无效；现拦截本地路径并用 `shell.openPath` 打开；`app://local-file` 可读范围扩展到整个 `~/.openclaw`（含 workspace 产物）。
- **聊天内 `MEDIA:` / 裸路径展示**：识别 OpenClaw 的 `MEDIA:C:\...` 指令与裸 Windows 路径；图片内嵌预览 + 可点文件名，避免只显示一行无法打开的灰色路径。

## [0.3.3] - 2026-08-03

### Fixed
- Gateway 协议协商支持 OpenClaw 2026.3（protocol 3）与 2026.7（protocol 4）。
- token mismatch 文案匹配与 operator scope 补全。

## [0.2.1] - 2026-03-22

### Added
- 安装包内置微信渠道插件，并在启动时自动同步到用户 Gateway 扩展目录。
- 新增微信扫码接入桥接能力，支持开始扫码、等待结果、取消扫码、退出登录和状态检测。

### Changed
- 微信渠道接入流程改为一键扫码、自动轮询、自动保存，并在成功后通过通知提示是否重启 Gateway。
- 飞书与企业微信渠道默认采用扫码接入路径，扫码成功后自动保存并关闭抽屉，减少手动填写负担。
- 飞书与企业微信的手动凭证配置收纳为“高级”模式，默认界面优先面向小白用户。
- 渠道卡片补充微信连接状态与更直观的入口文案，降低“账户/插件”概念理解成本。

### Fixed
- 修复微信扫码过程中关闭抽屉或退出应用后仍继续等待，最终产生超时报错的问题。
- 修复现有 React Hooks 依赖告警，保持 lint 输出干净。

## [0.2.0] - 2026-03-21

### Added
- 聊天页支持草稿会话在首次发送前选择智能体，并在首次发送时提交为真实会话。
- 模型页支持「编辑主/备模型」，可在同一弹窗中同时设置主模型与备用模型。
- 会话列表支持按日期分组展示（今天、昨天、其他日期）。
- 新增 `CHANGELOG.md`，建立版本化变更记录流程。

### Changed
- 聊天页将会话信息与智能体信息移至右上角元信息区域，减少输入区拥挤。
- 模型列表主模型星标补充悬浮提示，降低交互理解成本。
- GitHub Actions macOS 打包流程接入证书/公证密钥解码与注入（base64 secrets）。

### Fixed
- 修复实时聊天流式渲染与元信息同步问题（think/tools/usage 展示一致性改进）。
- 修复创建智能体后列表未及时刷新的问题（合并 runtime 与配置源数据）。
- 修复远程模型列表获取时 `baseUrl` 已包含 `/v1` 的路径拼接问题，避免重复 `/v1`。
- 修复 macOS `afterPack` 阶段因插件悬挂符号链接导致 `ENOENT` 打包失败的问题。

## [0.1.5] - 2026-03-20

### Changed
- 发布 `0.1.5` 版本。
