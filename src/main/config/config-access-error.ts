/**
 * openclaw.json 权限错误友好提示
 *
 * 常见原因：曾用 sudo / root 运行 openclaw，导致 ~/.openclaw/openclaw.json
 * 属主变成 root（mode 600），普通用户进程无法读写。
 */

import { CONFIG_PATH } from '../constants'

const ACCESS_MARKERS = [
  'EACCES',
  'permission denied',
  'Config file is not readable',
  'not readable by the current process',
]

export function isConfigPermissionError(input: unknown): boolean {
  const text =
    typeof input === 'string'
      ? input
      : input instanceof Error
        ? `${input.message}\n${input.stack ?? ''}`
        : String(input ?? '')
  const lower = text.toLowerCase()
  return ACCESS_MARKERS.some((marker) => lower.includes(marker.toLowerCase()))
}

/** 生成可直接给用户看的修复说明 */
export function formatConfigPermissionError(detail?: string): string {
  const hint = [
    '无法读写 OpenClaw 配置文件（权限不足）。',
    `文件：${CONFIG_PATH}`,
    '常见原因：曾用 sudo 运行过 openclaw，文件属主变成了 root。',
    '请在「终端」执行以下命令后重试：',
    `  sudo chown "$(id -u):$(id -g)" "${CONFIG_PATH}"`,
    '如仍失败，可一并修复目录：',
    `  sudo chown -R "$(id -u):$(id -g)" ~/.openclaw`,
  ]
  if (detail?.trim()) {
    hint.push('', `详情：${detail.trim().slice(0, 240)}`)
  }
  return hint.join('\n')
}

/** 将任意错误转为更可读的 Error（非权限错误原样返回） */
export function wrapConfigAccessError(err: unknown): Error {
  if (!isConfigPermissionError(err)) {
    return err instanceof Error ? err : new Error(String(err))
  }
  const detail = err instanceof Error ? err.message : String(err)
  return new Error(formatConfigPermissionError(detail))
}
