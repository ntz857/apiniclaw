/**
 * afterPack.js — electron-builder afterPack 钩子
 *
 * 在 electron-builder 完成文件收集（含 node_modules 剥离）之后、
 * 签名和生成安装包之前，将预构建的 Node.js + openclaw 资源注入到 app bundle。
 *
 * 目录结构（注入后）:
 *   macOS: ApiniClaw.app/Contents/Resources/gateway/ + runtime/
 *   Windows: resources/gateway/ + resources/runtime/
 *
 * 全平台注入独立 Node.js 运行时（openclaw 对 Node 版本有硬性要求，
 * 不能复用 Electron Helper 的内嵌 Node，例如 v24.14.0 不满足 openclaw 的 >=24.15.0）。
 */

"use strict";

const path = require("path");
const fs = require("fs");
const { Arch } = require("builder-util");

// ─── 工具函数 ───

function resolveArchName(arch) {
  if (typeof arch === "string") return arch;
  const name = Arch[arch];
  if (typeof name === "string") return name;
  throw new Error(`[afterPack] 无法识别 arch: ${String(arch)}`);
}

function resolveTargetId(context) {
  // 环境变量覆盖（调试/CI 场景）
  const fromEnv = process.env.APINICLAW_TARGET;
  if (fromEnv) return fromEnv;
  const platform = context.electronPlatformName;
  const arch = resolveArchName(context.arch);
  return `${platform}-${arch}`;
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else if (entry.isSymbolicLink()) {
      // 符号链接 → 解引用后复制实际文件（避免 asar/signing 问题）
      try {
        const real = fs.realpathSync(s);
        fs.copyFileSync(real, d);
        fs.chmodSync(d, fs.statSync(real).mode);
      } catch {
        // 悬挂链接（常见于 node_modules/.bin）直接跳过，避免 ENOENT 中断打包
        try {
          const target = fs.readlinkSync(s);
          console.warn(`[afterPack] 跳过悬挂符号链接: ${s} -> ${target}`);
        } catch {
          console.warn(`[afterPack] 跳过无法解析的符号链接: ${s}`);
        }
      }
    } else {
      fs.copyFileSync(s, d);
      fs.chmodSync(d, fs.statSync(s).mode);
    }
  }
}

function injectDir(src, dest, label, appOutDir) {
  if (!fs.existsSync(src)) {
    throw new Error(`[afterPack] 资源目录不存在: ${src}`);
  }
  copyDirSync(src, dest);
  console.log(`[afterPack] 已注入 ${label}/ → ${path.relative(appOutDir, dest)}`);
}

// ─── afterPack 入口 ───

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const appOutDir = context.appOutDir;
  const targetId = resolveTargetId(context);
  const arch = resolveArchName(context.arch);

  // 平台差异：macOS 资源在 .app 包内，Windows 直接在 resources/ 下
  const resourcesDir =
    platform === "darwin"
      ? path.join(
          appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources"
        )
      : path.join(appOutDir, "resources");

  const sourceBase = path.join(__dirname, "..", "resources", "targets", targetId);

  if (!fs.existsSync(sourceBase)) {
    throw new Error(
      [
        `[afterPack] 未找到目标资源目录: ${sourceBase}`,
        `请先执行资源打包:`,
        `  node scripts/package-resources.js --platform ${platform} --arch ${arch}`,
        `或通过 npm 脚本:`,
        `  npm run package:resources -- --platform ${platform} --arch ${arch}`,
      ].join("\n")
    );
  }

  console.log(`[afterPack] 使用目标资源: ${targetId}`);

  // ── 注入 gateway/（所有平台必须）──
  injectDir(
    path.join(sourceBase, "gateway"),
    path.join(resourcesDir, "gateway"),
    "gateway",
    appOutDir
  );

  // ── 验证插件已注入（构建时由 package-resources.js Step 3 写入 openclaw/extensions/）──
  const extDir = path.join(resourcesDir, "gateway", "node_modules", "openclaw", "extensions");
  if (fs.existsSync(extDir)) {
    const plugins = fs.readdirSync(extDir).filter((f) => {
      const manifest = path.join(extDir, f, "openclaw.plugin.json");
      return fs.existsSync(manifest);
    });
    if (plugins.length > 0) {
      console.log(`[afterPack] 已注入插件（${plugins.length} 个）: ${plugins.join(", ")}`);
    } else {
      console.warn(
        "[afterPack] ⚠️  extensions/ 存在但无有效插件，国内 IM 渠道功能不可用\n" +
          "           请重新执行: node scripts/package-resources.js"
      );
    }
  } else {
    console.warn(
      "[afterPack] ⚠️  未找到 openclaw/extensions/，国内 IM 渠道插件将不可用\n" +
        "           请重新执行: node scripts/package-resources.js"
    );
  }

  // ── 验证 clawhub CLI 已安装 ──
  const clawhubEntry = path.join(resourcesDir, "gateway", "node_modules", "clawhub", "bin", "clawdhub.js");
  if (fs.existsSync(clawhubEntry)) {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(resourcesDir, "gateway", "node_modules", "clawhub", "package.json"),
        "utf-8"
      )
    );
    console.log(`[afterPack] clawhub v${pkg.version} 已就绪`);
  } else {
    console.warn(
      "[afterPack] ⚠️  未找到 clawhub，skills 管理功能将不可用\n" +
        "           请重新执行: node scripts/package-resources.js"
    );
  }

  // ── 注入 runtime/（macOS + Windows：独立 Node.js，供 Gateway / CLI 使用）──
  injectDir(
    path.join(sourceBase, "runtime"),
    path.join(resourcesDir, "runtime"),
    "runtime",
    appOutDir
  );

  // 校验 Node + npm 入口存在（openclaw 会 spawn npm）
  const nodeBin =
    platform === "win32"
      ? path.join(resourcesDir, "runtime", "node.exe")
      : path.join(resourcesDir, "runtime", "bin", "node");
  const npmShim =
    platform === "win32"
      ? path.join(resourcesDir, "runtime", "npm.cmd")
      : path.join(resourcesDir, "runtime", "bin", "npm");
  if (!fs.existsSync(nodeBin)) {
    throw new Error(`[afterPack] 注入后未找到 Node 二进制: ${nodeBin}`);
  }
  if (!fs.existsSync(npmShim)) {
    throw new Error(
      `[afterPack] 注入后未找到 npm 入口: ${npmShim}\n` +
        `请重新执行: node scripts/package-resources.js --platform ${platform} --arch ${arch}`
    );
  }
  if (platform !== "win32") {
    for (const p of [nodeBin, npmShim]) {
      try {
        fs.chmodSync(p, 0o755);
      } catch (err) {
        console.warn(
          "[afterPack] chmod 失败:",
          p,
          err && err.message ? err.message : err
        );
      }
    }
  }
  console.log(`[afterPack] Node 运行时就绪: ${path.relative(appOutDir, nodeBin)}`);
  console.log(`[afterPack] npm 入口就绪: ${path.relative(appOutDir, npmShim)}`);

  // Windows：强制写入 exe 图标，避免任务栏仍显示旧图标
  if (platform === "win32") {
    try {
      const productName = context.packager.appInfo.productFilename || "ApiniClaw";
      const exePath = path.join(appOutDir, `${productName}.exe`);
      const icoPath = path.join(__dirname, "..", "assets", "icon.ico");
      if (fs.existsSync(exePath) && fs.existsSync(icoPath)) {
        // 优先用 rcedit npm API，否则调用 electron-winstaller 自带的 rcedit.exe
        let applied = false;
        try {
          const rcedit = require("rcedit");
          await rcedit(exePath, { icon: icoPath });
          applied = true;
        } catch {
          // fall through
        }
        if (!applied) {
          const { spawnSync } = require("child_process");
          const candidates = [
            path.join(__dirname, "..", "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
            path.join(__dirname, "..", "node_modules", "rcedit", "bin", "rcedit.exe"),
          ];
          const bin = candidates.find((p) => fs.existsSync(p));
          if (bin) {
            const res = spawnSync(bin, [exePath, "--set-icon", icoPath], {
              encoding: "utf8",
              windowsHide: true,
            });
            if (res.status === 0) applied = true;
            else {
              console.warn(
                "[afterPack] rcedit.exe 失败:",
                res.stderr || res.stdout || `exit ${res.status}`
              );
            }
          }
        }
        if (applied) {
          console.log(`[afterPack] 已写入 exe 图标: ${path.basename(exePath)}`);
        } else {
          console.warn("[afterPack] 未找到可用 rcedit，跳过 exe 图标写入");
        }
      }
    } catch (err) {
      console.warn("[afterPack] 写入 exe 图标失败:", err && err.message ? err.message : err);
    }
  }

  console.log("[afterPack] 资源注入完成");
};
