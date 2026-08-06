/**
 * Patch installed ClickClaw app.asar SkillHub marketplace to use api.skillhub.cn
 */
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

const asarPath =
  process.argv[2] ||
  path.join(process.env.LOCALAPPDATA, 'Programs', 'ClickClaw', 'resources', 'app.asar')

const fixedMainPath = path.resolve('out/main/index.js')
const workDir = path.join(process.env.TEMP || '/tmp', `clickclaw-asar-patch-${Date.now()}`)

function readAsarHeader(src) {
  const fd = fs.openSync(src, 'r')
  const sizeBuf = Buffer.alloc(16)
  fs.readSync(fd, sizeBuf, 0, 16, 0)
  const headerPickleSize = sizeBuf.readUInt32LE(4)
  const headerSize = sizeBuf.readUInt32LE(12)
  const headerBuf = Buffer.alloc(headerSize)
  fs.readSync(fd, headerBuf, 0, headerSize, 16)
  fs.closeSync(fd)
  const header = JSON.parse(headerBuf.toString('utf8'))
  const contentOffset = 8 + headerPickleSize
  return { header, contentOffset, headerPickleSize, headerSize }
}

function getNode(header, parts) {
  let n = header
  for (const p of parts) {
    if (!n.files?.[p]) throw new Error('missing ' + parts.join('/'))
    n = n.files[p]
  }
  return n
}

function extractFileByParts(src, parts) {
  const { header, contentOffset } = readAsarHeader(src)
  const node = getNode(header, parts)
  const fd = fs.openSync(src, 'r')
  const buf = Buffer.alloc(node.size)
  fs.readSync(fd, buf, 0, node.size, contentOffset + Number(node.offset))
  fs.closeSync(fd)
  return buf
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/**
 * In-place replace of a single file when new content length === old length.
 * Updates integrity hash in header.
 */
function replaceSameSizeFile(src, parts, newBuf) {
  const fd = fs.openSync(src, 'r+')
  const sizeBuf = Buffer.alloc(16)
  fs.readSync(fd, sizeBuf, 0, 16, 0)
  const headerPickleSize = sizeBuf.readUInt32LE(4)
  const headerSize = sizeBuf.readUInt32LE(12)
  const headerBuf = Buffer.alloc(headerSize)
  fs.readSync(fd, headerBuf, 0, headerSize, 16)
  const header = JSON.parse(headerBuf.toString('utf8'))
  const contentOffset = 8 + headerPickleSize

  const node = getNode(header, parts)
  if (newBuf.length !== node.size) {
    fs.closeSync(fd)
    throw new Error(`size mismatch: new=${newBuf.length} old=${node.size}`)
  }

  // update integrity
  const hash = sha256(newBuf)
  node.integrity = {
    algorithm: 'SHA256',
    hash,
    blockSize: 4194304,
    blocks: [hash],
  }

  // rewrite header JSON in place (same length required)
  const newHeaderJson = Buffer.from(JSON.stringify(header), 'utf8')
  if (newHeaderJson.length !== headerSize) {
    // try pad or fail
    if (newHeaderJson.length < headerSize) {
      // JSON.stringify is compact; original might be compact too — pad with spaces before final }
      // better: pad at end is invalid JSON. Use trailing spaces inside last empty? Not valid.
      // Actually asar header size field is the pickle string size; padding is after the string in pickle.
      // headerSize from readUInt32LE(12) is the json string size without padding.
      fs.closeSync(fd)
      throw new Error(
        `header size changed: ${newHeaderJson.length} vs ${headerSize} (delta ${newHeaderJson.length - headerSize})`
      )
    }
    fs.closeSync(fd)
    throw new Error(`header grew: ${newHeaderJson.length} > ${headerSize}`)
  }

  fs.writeSync(fd, newHeaderJson, 0, newHeaderJson.length, 16)
  fs.writeSync(fd, newBuf, 0, newBuf.length, contentOffset + Number(node.offset))
  fs.closeSync(fd)
  console.log('in-place patched', parts.join('/'), 'hash', hash.slice(0, 16) + '...')
}

function patchSkillHubInMain(installedText, fixedText) {
  function region(src) {
    const starts = [
      src.indexOf('function sortSkillHubItems'),
      src.indexOf('function mapSkillHubSort'),
      src.indexOf('let skillHubIndexCache'),
    ].filter((i) => i >= 0)
    const start = Math.min(...starts)
    // end before FindSkillMarketplace but include shared mapFindSkillItem if both have it
    // Replace only SkillHub helpers + class, stop at mapFindSkillItem if present after SkillHub
    let end = src.indexOf('class FindSkillMarketplace')
    // Prefer stopping at mapFindSkillItem to avoid duplicating it incorrectly
    const mapFind = src.indexOf('function mapFindSkillItem', start)
    if (mapFind > start && mapFind < end) end = mapFind
    if (!Number.isFinite(start) || end < 0) throw new Error(`region bounds start=${start} end=${end}`)
    return { start, end, text: src.slice(start, end) }
  }

  const oldR = region(installedText)
  const newR = region(fixedText)
  const before = installedText.slice(0, oldR.start)
  const after = installedText.slice(oldR.end)
  const oldBytes = Buffer.byteLength(installedText, 'utf8')
  const withoutRegion =
    Buffer.byteLength(before, 'utf8') + Buffer.byteLength(after, 'utf8')
  const targetRegionBytes = oldBytes - withoutRegion
  const newRegionBytes = Buffer.byteLength(newR.text, 'utf8')
  console.log('old region chars', oldR.text.length, 'bytes', targetRegionBytes)
  console.log('new region chars', newR.text.length, 'bytes', newRegionBytes)

  let replacement = newR.text
  const padBytes = targetRegionBytes - newRegionBytes
  if (padBytes < 0) {
    throw new Error(
      `new SkillHub region larger by ${-padBytes} bytes; cannot same-size patch`
    )
  }
  // ASCII spaces are 1 byte each — pad to exact byte length
  if (padBytes > 0) {
    replacement = replacement + ' '.repeat(padBytes)
  }

  const result = before + replacement + after
  if (Buffer.byteLength(result, 'utf8') !== oldBytes) {
    throw new Error(
      `byte length mismatch after pad: ${Buffer.byteLength(result, 'utf8')} vs ${oldBytes}`
    )
  }
  return result
}

// ── main ──
if (!fs.existsSync(asarPath)) {
  console.error('asar not found:', asarPath)
  process.exit(1)
}
if (!fs.existsSync(fixedMainPath)) {
  console.error('fixed main not found — run electron-vite build first')
  process.exit(1)
}

const installedMain = extractFileByParts(asarPath, ['out', 'main', 'index.js']).toString('utf8')
const fixedMain = fs.readFileSync(fixedMainPath, 'utf8')

console.log('installed has cos?', installedMain.includes('skillhub-1388575217'))
console.log('fixed has api?', fixedMain.includes('api.skillhub.cn'))

if (installedMain.includes('api.skillhub.cn') && !installedMain.includes('skills.json')) {
  console.log('already patched')
  process.exit(0)
}

const patched = patchSkillHubInMain(installedMain, fixedMain)
const patchedBuf = Buffer.from(patched, 'utf8')
const origSize = Buffer.byteLength(installedMain, 'utf8')
console.log('sizes', { orig: origSize, patched: patchedBuf.length })

if (patchedBuf.length !== origSize) {
  console.error('UTF-8 size mismatch after patch — abort')
  process.exit(1)
}

// sanity
if (!patched.includes('api.skillhub.cn')) {
  console.error('patch failed: api.skillhub.cn missing')
  process.exit(1)
}
if (patched.includes('skillhub-1388575217.cos')) {
  console.error('patch failed: old cos URL still present')
  process.exit(1)
}

const backup = asarPath + '.bak-skillhub'
if (!fs.existsSync(backup)) {
  fs.copyFileSync(asarPath, backup)
  console.log('backup ->', backup)
}

try {
  replaceSameSizeFile(asarPath, ['out', 'main', 'index.js'], patchedBuf)
  // verify
  const verify = extractFileByParts(asarPath, ['out', 'main', 'index.js']).toString('utf8')
  console.log('verify api.skillhub.cn', verify.includes('api.skillhub.cn'))
  console.log('verify old cos gone', !verify.includes('skillhub-1388575217.cos'))
  console.log('OK — restart ClickClaw')
} catch (e) {
  console.error('in-place patch failed:', e.message)
  console.log('falling back to full extract+pack...')

  fs.mkdirSync(workDir, { recursive: true })
  // Manual extract all files by walking header (more reliable than asar.extractAll path bugs)
  const { header, contentOffset } = readAsarHeader(asarPath)
  const fd = fs.openSync(asarPath, 'r')

  function walk(node, rel) {
    if (node.files) {
      const dir = path.join(workDir, rel)
      fs.mkdirSync(dir, { recursive: true })
      for (const [name, child] of Object.entries(node.files)) {
        walk(child, rel ? rel + '/' + name : name)
      }
      return
    }
    const dest = path.join(workDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const buf = Buffer.alloc(node.size)
    fs.readSync(fd, buf, 0, node.size, contentOffset + Number(node.offset))
    // replace main
    if (rel.replace(/\\/g, '/') === 'out/main/index.js') {
      fs.writeFileSync(dest, patchedBuf)
      console.log('wrote patched main')
    } else {
      fs.writeFileSync(dest, buf)
    }
  }
  walk(header, '')
  fs.closeSync(fd)

  const outAsar = asarPath + '.new'
  console.log('packing', outAsar)
  await asar.createPackage(workDir, outAsar)
  fs.renameSync(outAsar, asarPath)
  console.log('repacked OK, size', fs.statSync(asarPath).size)
  fs.rmSync(workDir, { recursive: true, force: true })
}
