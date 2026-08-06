import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GatewayAgentRow } from '../../../hooks/useGatewayWs'
import type { AgentConfig } from '../agents-page.types'

export function useAgentList(
  status: string,
  listAgents: () => Promise<{ agents: GatewayAgentRow[]; defaultId?: string } | null>
) {
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const loadAgents = useCallback(async () => {
    setLoading(true)
    try {
      const configAgents = (await window.api.agent.list()) as AgentConfig[]
      const configMap = new Map(configAgents.map((a) => [a.id, a]))

      if (status === 'ready') {
        const result = await listAgents()
        if (result) {
          const runtimeIds = new Set(result.agents.map((row) => row.id))
          const runtimeFirst: AgentConfig[] = result.agents.map((row) => {
            const conf = configMap.get(row.id)
            // 运行时列表不含 skills 等配置字段；必须从 openclaw.json 合并，
            // 否则技能页白名单看起来永远没保存成功
            return {
              ...(conf || {}),
              id: row.id,
              name: row.name || row.identity?.name || conf?.name,
              identity: row.identity || conf?.identity,
              default: row.id === result.defaultId || conf?.default,
              skills: conf?.skills,
              tools: conf?.tools ?? (row as { tools?: AgentConfig['tools'] }).tools,
              workspace: conf?.workspace ?? (row as { workspace?: string }).workspace,
              model: conf?.model ?? (row as { model?: AgentConfig['model'] }).model,
            }
          })
          const configOnly: AgentConfig[] = configAgents.filter(
            (agent) => !runtimeIds.has(agent.id)
          )
          const list: AgentConfig[] = [...runtimeFirst, ...configOnly]
          setAgents(list)
          setSelectedId((prev) => {
            if (prev && list.some((a) => a.id === prev)) return prev
            return list[0]?.id || null
          })
          return
        }
      }
      const list = configAgents
      setAgents(list)
      setSelectedId((prev) => {
        if (prev && list.some((a) => a.id === prev)) return prev
        return list[0]?.id || null
      })
    } finally {
      setLoading(false)
    }
  }, [status, listAgents])

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedId) || null,
    [agents, selectedId]
  )

  return {
    agents,
    loading,
    selectedId,
    selectedAgent,
    setSelectedId,
    loadAgents,
  }
}
