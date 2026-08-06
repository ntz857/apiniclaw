import { App } from 'antd'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentPreset, AgentWorkspaceFiles } from '../agent-presets.data'
import type { AgentPresetCreatePayload } from '../components/AgentPresetPickerDrawer'
import type { AgentConfig, AgentFormValues } from '../agents-page.types'
import { formToAgent } from '../agents-page.utils'

interface UseAgentActionsArgs {
  agents: AgentConfig[]
  loadAgents: () => Promise<void>
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>
  wsReady: boolean
  callRpc: (method: string, params: unknown) => Promise<unknown>
}

function resolveDefaultWorkspace(agentId: string): string {
  const normalized = agentId.trim().toLowerCase()
  if (normalized === 'main') return '~/.openclaw/workspace'
  return `~/.openclaw/workspace-${normalized}`
}

function buildSetDefaultPatch(agents: AgentConfig[], targetAgentId: string): string {
  const targetId = targetAgentId.trim().toLowerCase()
  const list = agents
    .filter((item) => typeof item.id === 'string' && item.id.trim())
    .map((item) => ({
      id: item.id,
      default: item.id.trim().toLowerCase() === targetId,
    }))

  return JSON.stringify({
    agents: { list },
  })
}

const WORKSPACE_FILE_ORDER: Array<keyof AgentWorkspaceFiles> = [
  'SOUL.md',
  'IDENTITY.md',
  'AGENTS.md',
  'USER.md',
  'TOOLS.md',
  'HEARTBEAT.md',
]

export function useAgentActions({
  agents,
  loadAgents,
  setSelectedId,
  wsReady,
  callRpc,
}: UseAgentActionsArgs) {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [presetPickerOpen, setPresetPickerOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const openCreateDrawer = useCallback(() => setPresetPickerOpen(true), [])
  const closePresetPicker = useCallback(() => {
    if (!creating) setPresetPickerOpen(false)
  }, [creating])
  const openCustomCreateDrawer = useCallback(() => {
    setPresetPickerOpen(false)
    setDrawerOpen(true)
  }, [])
  const closeCreateDrawer = useCallback(() => {
    if (!creating) setDrawerOpen(false)
  }, [creating])

  const handleSaveAgent = useCallback(
    async (updated: AgentConfig): Promise<void> => {
      await window.api.agent.save(updated)
      if (updated.default && updated.id) {
        await window.api.agent.setDefault(updated.id)
      }
      await loadAgents()
    },
    [loadAgents]
  )

  const writeWorkspaceFiles = useCallback(
    async (agentId: string, files: AgentWorkspaceFiles): Promise<void> => {
      if (!wsReady) return
      for (const name of WORKSPACE_FILE_ORDER) {
        const content = files[name]
        if (!content) continue
        try {
          await callRpc('agents.files.set', { agentId, name, content })
        } catch {
          // 单文件失败不阻断其余
        }
      }
    },
    [callRpc, wsReady]
  )

  const persistNewAgent = useCallback(
    async (
      values: AgentFormValues,
      options?: {
        files?: AgentWorkspaceFiles
        skills?: string[]
      }
    ): Promise<AgentConfig> => {
      const agentData = formToAgent(values)
      // 模板：tools=full + skills allowlist
      if (options?.skills && options.skills.length > 0) {
        agentData.skills = options.skills
      }
      if (!agentData.tools?.profile) {
        agentData.tools = { profile: values.toolsProfile || 'full' }
      }

      let saved: AgentConfig

      if (wsReady) {
        try {
          const createResult = (await callRpc('agents.create', {
            name: values.id,
            workspace: resolveDefaultWorkspace(values.id),
            emoji: values.emoji || undefined,
          })) as { agentId?: string }
          const createdId = createResult?.agentId || values.id
          saved = (await window.api.agent.save({ ...agentData, id: createdId })) as AgentConfig
        } catch {
          saved = (await window.api.agent.save(agentData)) as AgentConfig
        }
      } else {
        saved = (await window.api.agent.save(agentData)) as AgentConfig
      }

      if (values.setAsDefault && saved.id) {
        await window.api.agent.setDefault(saved.id)
      }

      if (options?.files && saved.id) {
        await writeWorkspaceFiles(saved.id, options.files)
      }

      // 将 skill 安装到该 agent 的 workspace/skills（按智能体隔离）
      if (options?.skills && options.skills.length > 0 && saved.id) {
        try {
          const skillResult = await window.api.agent.installSkills(saved.id, options.skills)
          // allowlist 仅保留实际装上的 skill，避免空引用
          if (skillResult.installed.length > 0) {
            saved = (await window.api.agent.save({
              ...saved,
              skills: skillResult.installed,
            })) as AgentConfig
          }
          // 把结果挂到对象上供上层 toast（非持久字段）
          ;(saved as AgentConfig & { _skillInstall?: typeof skillResult })._skillInstall =
            skillResult
        } catch {
          // 安装失败不阻断创建
        }
      }

      return saved
    },
    [callRpc, writeWorkspaceFiles, wsReady]
  )

  const handleCreateAgent = useCallback(
    async (values: AgentFormValues): Promise<void> => {
      setCreating(true)
      try {
        // 空白自定义也默认 full，避免权限过窄
        const saved = await persistNewAgent({
          ...values,
          toolsProfile: values.toolsProfile || 'full',
        })
        message.success(t('agents.saveSuccess'))
        setDrawerOpen(false)
        setPresetPickerOpen(false)
        if (saved.id) setSelectedId(saved.id)
        await loadAgents()
      } catch (err) {
        message.error(
          t('agents.saveFailed', { error: err instanceof Error ? err.message : String(err) })
        )
      } finally {
        setCreating(false)
      }
    },
    [loadAgents, message, persistNewAgent, setSelectedId, t]
  )

  /** 从预设模板创建（可自定义名称） */
  const handleCreateFromPreset = useCallback(
    async (payload: AgentPresetCreatePayload): Promise<void> => {
      setCreating(true)
      try {
        const { preset, id, displayName } = payload
        const theme = t(`agents.presets.items.${preset.i18nKey}.theme`)
        const files = preset.buildFiles({
          name: displayName,
          emoji: preset.emoji,
          theme,
        })
        const values: AgentFormValues = {
          id,
          displayName,
          emoji: preset.emoji,
          theme,
          toolsProfile: 'full',
          setAsDefault: false,
        }
        const saved = await persistNewAgent(values, {
          files,
          skills: preset.skills,
        })
        const skillInstall = (
          saved as AgentConfig & {
            _skillInstall?: { installed: string[]; missing: string[]; copied: string[] }
          }
        )._skillInstall
        if (skillInstall) {
          if (skillInstall.missing.length > 0) {
            message.warning(
              t('agents.presets.createPartialSkills', {
                name: displayName,
                installed: skillInstall.installed.length,
                missing: skillInstall.missing.join(', '),
              })
            )
          } else {
            message.success(
              t('agents.presets.createSuccessWithSkills', {
                name: displayName,
                count: skillInstall.installed.length,
              })
            )
          }
        } else {
          message.success(t('agents.presets.createSuccess', { name: displayName }))
        }
        setPresetPickerOpen(false)
        setDrawerOpen(false)
        if (saved.id) setSelectedId(saved.id)
        await loadAgents()
      } catch (err) {
        message.error(
          t('agents.saveFailed', { error: err instanceof Error ? err.message : String(err) })
        )
      } finally {
        setCreating(false)
      }
    },
    [loadAgents, message, persistNewAgent, setSelectedId, t]
  )

  const handleDelete = useCallback(
    async (agent: AgentConfig): Promise<void> => {
      if (agent.id === 'main') return
      if (wsReady) {
        try {
          await callRpc('agents.delete', { agentId: agent.id, deleteFiles: true })
        } catch {
          await window.api.agent.delete(agent.id)
        }
      } else {
        await window.api.agent.delete(agent.id)
      }
      message.success(t('agents.deleteSuccess'))
      setSelectedId((prev) => {
        if (prev !== agent.id) return prev
        const remaining = agents.filter((a) => a.id !== agent.id)
        return remaining[0]?.id || null
      })
      await loadAgents()
    },
    [agents, callRpc, loadAgents, message, setSelectedId, t, wsReady]
  )

  const handleSetDefault = useCallback(
    async (agent: AgentConfig): Promise<void> => {
      if (wsReady) {
        try {
          await callRpc('config.patch', {
            raw: buildSetDefaultPatch(agents, agent.id),
            note: `clickclaw:set-default-agent:${agent.id}`,
          })
        } catch {
          await window.api.agent.setDefault(agent.id)
        }
      } else {
        await window.api.agent.setDefault(agent.id)
      }
      message.success(t('agents.setDefaultSuccess'))
      await loadAgents()
    },
    [agents, callRpc, loadAgents, message, t, wsReady]
  )

  return {
    drawerOpen,
    presetPickerOpen,
    creating,
    openCreateDrawer,
    openCustomCreateDrawer,
    closeCreateDrawer,
    closePresetPicker,
    handleSaveAgent,
    handleCreateAgent,
    handleCreateFromPreset,
    handleDelete,
    handleSetDefault,
  }
}
