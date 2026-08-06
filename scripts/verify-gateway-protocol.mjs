/**
 * Live handshake check against a running OpenClaw Gateway.
 * Verifies ApiniClaw connect frame (protocol 3–4 + device v3 signature) succeeds.
 *
 * Usage:
 *   node scripts/verify-gateway-protocol.mjs [ws://127.0.0.1:18789] [token]
 *
 * Token defaults to gateway.auth.token from ~/.openclaw/openclaw.json
 */
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Must use `ws` so we can set Origin: app://localhost (Control UI allowlist).
// Node's global WebSocket does not allow custom Origin headers.
const WebSocketImpl = require('ws')

const url = process.argv[2] || 'ws://127.0.0.1:18789'
const tokenArg = process.argv[3]

function loadToken() {
  if (tokenArg) return tokenArg
  const cfgPath = join(homedir(), '.openclaw', 'openclaw.json')
  if (!existsSync(cfgPath)) throw new Error(`no token and missing ${cfgPath}`)
  const raw = readFileSync(cfgPath, 'utf8')
  // openclaw.json is often JSON5 (unquoted keys) after ApiniClaw/doctor rewrites
  try {
    const cfg = JSON.parse(raw)
    const token = cfg?.gateway?.auth?.token
    if (token) return token
  } catch {
    // fall through to regex
  }
  const m = raw.match(/token\s*:\s*['"]([^'"]+)['"]/) || raw.match(/"token"\s*:\s*"([^"]+)"/)
  if (m?.[1]) return m[1]
  throw new Error('gateway.auth.token not found in openclaw.json')
}

function toBase64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

function makeIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' })
  const rawPublicKey = spkiDer.subarray(12)
  const pkcs8Der = privateKey.export({ type: 'pkcs8', format: 'der' })
  return {
    deviceId: createHash('sha256').update(rawPublicKey).digest('hex'),
    publicKeyBase64url: toBase64url(rawPublicKey),
    privateKeyPkcs8Base64: pkcs8Der.toString('base64'),
  }
}

function signPayload(pkcs8Base64, payload) {
  const key = createPrivateKey({
    key: Buffer.from(pkcs8Base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  })
  return toBase64url(sign(null, Buffer.from(payload, 'utf8'), key))
}

function buildConnectFrame(nonce, token, identity) {
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
  const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
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
  const signature = signPayload(identity.privateKeyPkcs8Base64, payload)
  return {
    type: 'req',
    id: `connect-verify-${Date.now()}`,
    method: 'connect',
    params: {
      minProtocol: 3,
      maxProtocol: 4,
      client: {
        id: 'openclaw-control-ui',
        version: '0.3.3-verify',
        platform: osName,
        deviceFamily,
        mode: 'ui',
      },
      role,
      scopes,
      device: {
        id: identity.deviceId,
        publicKey: identity.publicKeyBase64url,
        signature,
        signedAt: signedAtMs,
        nonce,
      },
      auth: { token },
      caps: ['tool-events'],
      locale: 'zh-CN',
      userAgent: 'apiniclaw/0.3.3-verify',
    },
  }
}

const token = loadToken()
const identity = makeIdentity()

console.log(`Connecting to ${url} ...`)

await new Promise((resolve, reject) => {
  const ws = new WebSocketImpl(url, {
    headers: { Origin: 'app://localhost' },
  })
  const timer = setTimeout(() => {
    try {
      ws.close()
    } catch {
      /* ignore */
    }
    reject(new Error('timeout waiting for hello-ok'))
  }, 15000)

  let connectId = null
  let settled = false
  const finish = (fn) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    fn()
  }

  ws.on('open', () => console.log('WS open, waiting for connect.challenge...'))
  ws.on('error', (err) => finish(() => reject(err)))
  ws.on('message', (data) => {
    let frame
    try {
      frame = JSON.parse(data.toString())
    } catch {
      return
    }

    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      const nonce = frame.payload?.nonce ?? ''
      const req = buildConnectFrame(nonce, token, identity)
      connectId = req.id
      console.log(`challenge ok, sending connect min=${req.params.minProtocol} max=${req.params.maxProtocol}`)
      ws.send(JSON.stringify(req))
      return
    }

    if (frame.type === 'res' && frame.id === connectId) {
      if (frame.ok) {
        console.log('SUCCESS: handshake accepted')
        console.log('  protocol:', frame.payload?.protocol)
        console.log('  server:', frame.payload?.server?.version ?? frame.payload?.server)
        console.log('  auth.role:', frame.payload?.auth?.role)
        console.log('  auth.scopes:', frame.payload?.auth?.scopes)
        try {
          ws.close()
        } catch {
          /* ignore */
        }
        finish(() => resolve())
      } else {
        console.error('FAIL: connect rejected')
        console.error(JSON.stringify(frame.error, null, 2))
        try {
          ws.close()
        } catch {
          /* ignore */
        }
        finish(() => reject(new Error(frame.error?.message || 'connect rejected')))
      }
    }
  })
})

console.log('verify-gateway-protocol: OK')
