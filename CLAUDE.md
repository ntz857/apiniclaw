# ApiniClaw — 项目规则

> 本文件是 AI 开发助手的持久记忆。每次打开项目时自动加载。
>
> **产品 / npm / 技术标识统一为 ApiniClaw / apiniclaw。**

---

## 产品信息

| 项 | 当前值 |
|----|--------|
| **产品名称** | ApiniClaw |
| **npm name** | `apiniclaw` |
| **App ID / AUMID** | `com.apiniclaw.app` |
| **数据目录** | `~/.apiniclaw/`（日志 `apiniclaw.log`；用户 openclaw 升级目录 `~/.apiniclaw/gateway/`） |
| **可执行文件** | Windows：`ApiniClaw.exe`；产物名：`ApiniClaw-Setup-*` / `ApiniClaw-*` |
| **当前版本** | `0.3.18`（semver `x.y.z`） |
| **OpenClaw** | 内置/打包资源沿用上游日历版本（如 `2026.7.x`）；与应用 semver 解耦 |
| **目标平台** | macOS（arm64 + x64）、Windows（x64 + arm64） |
| **Git 仓库** | https://github.com/ntz857/apiniclaw |
| **许可证** | AGPL-3.0 |

### 官方域名（唯一来源：`src/shared/urls.ts`）

| 用途 | URL | 常量 |
|------|-----|------|
| 官网 | https://www.apiniclaw.com | `APINICLAW_WEBSITE_URL` |
| API | https://api.apiniclaw.com | `APINICLAW_API_BASE_URL` |
| 文档 | https://docs.apiniclaw.com | `APINICLAW_DOCS_URL` |
| 自动更新 CDN | https://update.apinibee.com | `APINICLAW_UPDATE_BASE_URL` |

技术标识一律使用 `APINICLAW_*` / `apiniclaw` / `~/.apiniclaw`。

---

## 产品定位

ApiniClaw 是面向**小白用户**的 OpenClaw 桌面管理工具：内置 Node.js + openclaw 运行时，零依赖安装即用。  
核心能力：Gateway 管理、智能体/会话/模型/技能/定时任务/渠道接入、自动更新。

### 智能体预设

- 模板库来源：社区 [awesome-openclaw-agents](https://github.com/mergisi/awesome-openclaw-agents) 全量中文本地化（约 **196** 个）。
- 数据文件：`src/renderer/src/pages/agents/agent-presets.data.ts`（由脚本生成，勿手改大段 SOUL）。
- i18n：`agents.presets.items.*`（`zh-CN.json` / `en.json`）。
- 重建流程：
  1. `node scripts/translate-awesome-souls.mjs`（默认读 Reasonix `DEEPSEEK_API_KEY` → `https://api.deepseek.com/v1`，模型 `deepseek-chat`）
  2. `node scripts/build-presets-from-zh.mjs`
- 质检缓存：`.cache/awesome-souls/`（gitignore，勿提交）。

---

## 技术栈（必须遵守）

| 层级 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Electron | 40+ |
| 构建工具 | electron-vite | 5 / 7.x |
| 渲染层 | React + TypeScript | 19 / 5.9+ |
| UI 组件库 | **Ant Design** | **6.x** |
| 状态管理 | Zustand | 5 |
| 路由 | react-router-dom | 7 |
| 国际化 | i18next + react-i18next | latest |
| JSON5 解析 | json5 | latest |
| 打包 | electron-builder | 26+ |
| 更新 | electron-updater (generic CDN) | latest |
| 日志 | electron-log | 5 |
| 单元测试 | Vitest | 4.x |

### 严禁使用

- Tailwind CSS（使用 Ant Design token 主题系统替代）
- 原生 CSS-in-JS 方案
- 其他 UI 组件库（MUI、Chakra 等）

### Ant Design 规范

- **版本：6.x**
- **AI 文档索引：** https://ant.design/llms.txt
- **AI 完整文档：** https://ant.design/llms-full.txt
- **使用组件时务必先查询上述文档**，确保 API 用法与 6.x 版本一致

---

## 品牌色

| 用途 | 色值 | 名称 |
|------|------|------|
| **主色** | `#FF4D2A` | 活力橙红 |
| 辅色 | `#FF7A5C` | 浅橙 |
| 深色 | `#CC3D21` | 深橙红 |
| 背景深色 | `#7A1A0F` | 龙虾棕 |

```typescript
// 主题配置基准
{
  token: { colorPrimary: '#FF4D2A', borderRadius: 8 },
  algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
  locale: zhCN,
}
```

---

## 核心架构约束

### OpenClaw 配置格式（极其重要）

- 配置文件：`~/.openclaw/openclaw.json`，格式为 **JSON5**（支持注释和尾逗号）
- OpenClaw **严格校验**配置，**未知字段会导致 Gateway 拒绝启动**
- 模型引用格式：`provider/model`（如 `anthropic/claude-opus-4-6`）
- Gateway 端口解析顺序：env `OPENCLAW_GATEWAY_PORT` > config `gateway.port` > 默认 `18789`
- 内置 Provider 无需 `models.providers`，只需 `.env` 中设 auth 环境变量
- Auth 凭证写入 `~/.openclaw/.env`，**不写入 openclaw.json**
- **运行时解析**（`openclaw-resolve`）：优先系统/npm openclaw → `~/.apiniclaw/gateway` → 安装包内置

### Gateway 协议

- 需兼容 OpenClaw **2026.3（protocol 3）与 2026.7（protocol 4）**
- WS `connect` 使用 `minProtocol=3` / `maxProtocol=4`
- 设备签名与线协议版本解耦；token mismatch 需识别多种文案并清 token 重连

### Runtime 接口

```typescript
interface OpenclawRuntime {
  getNodePath(): string
  getGatewayEntry(): string
  getEnv(): Record<string, string>
  install?(): Promise<void>  // 仅 BundledRuntime
}
```

上层代码通过此接口操作，不感知是系统模式还是内置模式。

### 自定义协议 app://

打包后使用 `app://localhost` 协议加载页面（非 `file://`），解决 WebSocket origin 被拒问题。通过 `registerSchemesAsPrivileged` + `protocol.handle` 注册。

---

## 项目结构概览

```
src/
├── main/                  # Electron 主进程
│   ├── index.ts
│   ├── ipc-handlers.ts
│   ├── config/
│   ├── gateway/
│   ├── runtime/
│   └── services/
├── preload/
├── renderer/src/
│   ├── App.tsx
│   ├── layouts/
│   ├── pages/agents/      # agent-presets.data.ts
│   └── i18n/
├── shared/                # urls.ts 等
└── test/

scripts/
├── package-resources.js
├── afterPack.js
├── translate-awesome-souls.mjs
├── build-presets-from-zh.mjs
└── check-release-artifacts.js

electron-builder.yml       # productName: ApiniClaw；appId: com.apiniclaw.app
```

---

## 构建与运行

```bash
npm run dev
npm run build
npm run build:win
npm run build:unpack
npm run lint
npm run typecheck
npm test
```

### 本地固定路径打包

```bash
npm run build
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npx electron-builder --dir --x64 --config.directories.output=dist-apini --config.win.signAndEditExecutable=false
# dist-apini\win-unpacked\ApiniClaw.exe
```

`dist/`、`dist-apini*` 已 gitignore。

### 提交前检查（必须）

- `npm run format:check`
- `npm run lint`

### 发版

1. bump `package.json` + `CHANGELOG.md`
2. commit → tag `vX.Y.Z` → push
3. GitHub Release；CI 上传 `ApiniClaw-*` 产物
4. workflow：`Release packages (win + mac)`（`release-win-mac.yml`）

---

## 代码规范

- TypeScript strict
- ESM（renderer）/ CommonJS（main + preload）
- 中文注释优先
- 组件 PascalCase；服务 kebab-case
- i18n key：`page.section.label`；UI 文案禁止硬编码
- 品牌与技术标识：`ApiniClaw` / `apiniclaw` / `APINICLAW_*`

### 页面模块化

```
pages/<name>/
├── <Name>Page.tsx
├── <name>-page.types.ts
├── <name>-page.utils.ts
├── hooks/
└── components/
```

---

## 测试（Vitest）

```bash
npm test
npm run test:watch
npm run test:coverage
```

**必须测：** 配置读写、.env、CLI RC、复杂纯函数  
**不必测：** Gateway 启停、PATH、完整 FS 流程

---

## 文档约定

- 讨论/方案 → `discuss/`
- 开发规则 → `.rule/`
- 文档使用简体中文
- `AGENTS.md` 指向本文件
