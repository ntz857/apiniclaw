import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const raw = readFileSync(join(homedir(), '.openclaw', 'openclaw.json'), 'utf8')
const token =
  raw.match(/token\s*:\s*['"]([^'"]+)['"]/)?.[1] ||
  raw.match(/"token"\s*:\s*"([^"]+)"/)?.[1]
const identity = JSON.parse(
  readFileSync(join(homedir(), '.apiniclaw', 'device-identity.json'), 'utf8')
)
if (!token) throw new Error('no token')

function b64u(b) {
  return Buffer.from(b).toString('base64url')
}
function signPayload(p) {
  const k = createPrivateKey({
    key: Buffer.from(identity.privateKeyPkcs8Base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  })
  return b64u(sign(null, Buffer.from(p, 'utf8'), k))
}
function connectFrame(nonce) {
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
    'windows',
    'desktop',
  ].join('|')
  return {
    type: 'req',
    id: 'c' + Date.now(),
    method: 'connect',
    params: {
      minProtocol: 3,
      maxProtocol: 4,
      client: {
        id: 'openclaw-control-ui',
        version: '0.3.3',
        platform: 'windows',
        deviceFamily: 'desktop',
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
    },
  }
}

const ws = new WebSocket('ws://127.0.0.1:18789', {
  headers: { Origin: 'app://localhost' },
})
let connectId = null
let cronId = null
let removeId = null

ws.on('message', (d) => {
  const f = JSON.parse(d.toString())
  if (f.event === 'connect.challenge') {
    const req = connectFrame(f.payload?.nonce || '')
    connectId = req.id
    ws.send(JSON.stringify(req))
    return
  }
  if (f.type === 'res' && f.id === connectId) {
    if (!f.ok) {
      console.error('connect fail', f.error)
      process.exit(1)
    }
    console.log('connected protocol', f.payload?.protocol)
    cronId = 'cron-test-' + Date.now()
    // OLD shape (should fail): payload.message + agentId inside payload, no sessionTarget
    // NEW shape (must pass):
    const add = {
      type: 'req',
      id: cronId,
      method: 'cron.add',
      params: {
        name: 'apiniclaw-schema-test',
        description: 'temp verify',
        agentId: 'main',
        schedule: { kind: 'every', everyMs: 3_600_000 },
        sessionTarget: 'isolated',
        wakeMode: 'now',
        payload: { kind: 'agentTurn', message: 'ping from schema test' },
        enabled: false,
      },
    }
    ws.send(JSON.stringify(add))
    return
  }
  if (f.type === 'res' && f.id === cronId) {
    console.log(
      JSON.stringify(
        { ok: f.ok, err: f.error, jobId: f.payload?.id || f.payload?.job?.id },
        null,
        2
      )
    )
    if (f.ok) {
      const jid = f.payload?.id || f.payload?.job?.id
      if (jid) {
        removeId = 'rm' + Date.now()
        ws.send(
          JSON.stringify({
            type: 'req',
            id: removeId,
            method: 'cron.remove',
            params: { id: jid },
          })
        )
        return
      }
    }
    ws.close()
    process.exit(f.ok ? 0 : 1)
  }
  if (f.type === 'res' && f.id === removeId) {
    console.log('cleanup', f.ok ? 'ok' : f.error)
    ws.close()
    process.exit(0)
  }
})
ws.on('error', (e) => {
  console.error(e)
  process.exit(1)
})
setTimeout(() => {
  console.error('timeout')
  process.exit(2)
}, 20000)
