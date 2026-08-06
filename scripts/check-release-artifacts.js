"use strict";

const fs = require("fs");
const path = require("path");

function fail(message) {
  console.error(`[release-artifacts] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { platform: "", dir: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--platform") opts.platform = argv[++i] || "";
    else if (arg === "--dir") opts.dir = argv[++i] || "";
  }
  if (!opts.platform || !opts.dir) {
    fail("鐢ㄦ硶: node scripts/check-release-artifacts.js --platform <win|mac> --dir <dist>");
  }
  if (!["win", "mac"].includes(opts.platform)) {
    fail(`涓嶆敮鎸佺殑骞冲彴: ${opts.platform}`);
  }
  return opts;
}

function listFiles(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

function findMatches(files, re) {
  return files.filter((name) => re.test(name));
}

const { platform, dir } = parseArgs(process.argv.slice(2));
const absDir = path.resolve(dir);
const files = listFiles(absDir);

if (files.length === 0) {
  fail(`鐩綍涓虹┖鎴栦笉瀛樺湪: ${absDir}`);
}

if (platform === "win") {
  const installers = findMatches(files, /^(ApiniClaw)-Setup-.*\.exe$/);
  const manifests = findMatches(files, /^latest\.yml$/);
  if (installers.length === 0) fail(`鏈壘鍒?Windows 瀹夎鍖? ${absDir}`);
  if (manifests.length === 0) fail(`鏈壘鍒?Windows 鏇存柊娓呭崟 latest.yml: ${absDir}`);
  console.log(`[release-artifacts] win installers: ${installers.join(", ")}`);
  console.log(`[release-artifacts] win manifest: ${manifests.join(", ")}`);
} else {
  const dmgs = findMatches(files, /^(ApiniClaw)-.*\.dmg$/);
  const zips = findMatches(files, /^(ApiniClaw)-.*\.zip$/);
  const manifests = findMatches(files, /^latest-mac\.yml$/);
  if (dmgs.length === 0) fail(`鏈壘鍒?macOS DMG: ${absDir}`);
  if (zips.length === 0) fail(`鏈壘鍒?macOS ZIP: ${absDir}`);
  if (manifests.length === 0) fail(`鏈壘鍒?macOS 鏇存柊娓呭崟 latest-mac.yml: ${absDir}`);
  console.log(`[release-artifacts] mac dmg: ${dmgs.join(", ")}`);
  console.log(`[release-artifacts] mac zip: ${zips.join(", ")}`);
  console.log(`[release-artifacts] mac manifest: ${manifests.join(", ")}`);
}
