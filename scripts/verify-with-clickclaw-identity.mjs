import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const identity = JSON.parse(
  readFileSync(join(homedir(), '.clickclaw', 'device-identity.json'), 'utf8')
)
const raw = readFileSync(join(homedir(), '.openclaw', 'openclaw.json'), 'utf8')
const token =
  raw.match(/token\s*:\s*['"]([^'"]+)['"]/)?.[1] ||
  raw.match(/"token"\s*:\s*"([^"]+)"/)?.[1]
if (!token) throw new Error('no token')

console.log('device', identity.deviceId.slice(0, 16), 'token', token.slice(0, 8) + '...')

function b64u(b) {
  return Buffer.from(b).toString('base64url')
}

function signPayload(payload) {
  const key = createPrivateKey({
    key: Buffer.from(identity.privateKeyPkcs8Base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  })
  return b64u(sign(null, Buffer.from(payload, 'utf8'), key))
}

function build(nonce) {
  const role = 'operator'
  const scopes = [
    'operator.admin',
    'operator.approvals',
    'operator.pairing',
    'operator.read',
    'operator.talk.secrets',
    'operator.write',
  ]
  const signedAtMs = Date.now()
  const osName = 'windows'
  const deviceFamily = 'desktop'
  const payload = [
    'v3',
    identity.deviceId,
    'openclaw-control-ui',
    'ui',
    role,
    scopes.join(','),
    String(signedAtMs),
    token,
    nonce,
    osName,
    deviceFamily,
  ].join('|')
  return {
    type: 'req',
    id: 'c-' + Date.now(),
    method: 'connect',
    params: {
      minProtocol: 3,
      maxProtocol: 4,
      client: {
        id: 'openclaw-control-ui',
        version: '0.3.2',
        platform: osName,
        deviceFamily,
        mode: 'ui',
      },
      role,
      scopes,
      device: {
        id: identity.deviceId,
        publicKey: identity.publicKeyBase64url,
        signature: signPayload(payload),
        signedAt: signedAtMs,
        nonce,
      },
      auth: { token },
      caps: ['tool-events'],
      locale: 'zh-CN',
      userAgent: 'clickclaw/0.3.2',
    },
  }
}

const ws = new WebSocket('ws://127.0.0.1:18789', {
  headers: { Origin: 'app://localhost' },
})
let id = null
ws.on('message', (d) => {
  const f = JSON.parse(d.toString())
  if (f.event === 'connect.challenge') {
    const req = build(f.payload?.nonce || '')
    id = req.id
    ws.send(JSON.stringify(req))
  } else if (f.type === 'res' && f.id === id) {
    console.log(
      JSON.stringify(
        {
          ok: f.ok,
          protocol: f.payload?.protocol,
          err: f.error,
          auth: f.payload?.auth,
        },
        null,
        2
      )
    )
    ws.close()
    process.exit(f.ok ? 0 : 1)
  }
})
ws.on('error', (e) => {
  console.error(e)
  process.exit(1)
})
setTimeout(() => {
  console.error('timeout')
  process.exit(2)
}, 15000)
