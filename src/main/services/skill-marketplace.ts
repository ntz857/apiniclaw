/**
 * Skill Marketplace 抽象接口 + ClawHub / SkillHub 实现
 *
 * 通过 SkillMarketplace 接口解耦，未来可无缝接入其他 skill 市场。
 */

import { proxyFetch } from '../utils/proxy'

// ========== 共享数据类型 ==========

export interface SkillSearchResult {
  slug: string
  displayName: string
  summary: string
  version: string
  updatedAt: number
  score?: number
}

export interface SkillBrowseItem {
  slug: string
  displayName: string
  summary: string
  stats: { downloads?: number; stars?: number }
  updatedAt: number
  latestVersion?: { version: string }
}

export interface SkillBrowseResult {
  items: SkillBrowseItem[]
  nextCursor: string | null
}

export interface SkillMarketplaceInfo {
  id: string
  name: string
  baseUrl: string
}

// ========== 抽象接口 ==========

export interface SkillMarketplace extends SkillMarketplaceInfo {
  search(query: string, opts?: { limit?: number }): Promise<SkillSearchResult[]>
  browse(opts?: { limit?: number; sort?: string; cursor?: string }): Promise<SkillBrowseResult>
  download(slug: string, version?: string): Promise<Buffer>
}

// ========== ClawHub 实现 ==========

export class ClawHubMarketplace implements SkillMarketplace {
  readonly id = 'clawhub'
  readonly name = 'ClawHub'
  readonly baseUrl: string

  constructor(baseUrl = 'https://clawhub.ai') {
    this.baseUrl = baseUrl
  }

  async search(query: string, opts?: { limit?: number }): Promise<SkillSearchResult[]> {
    const limit = opts?.limit ?? 20
    const url = `${this.baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`ClawHub search failed: HTTP ${res.status}`)
    const data = (await res.json()) as {
      items?: SkillSearchResult[]
      results?: SkillSearchResult[]
    }
    return data.items ?? data.results ?? []
  }

  async browse(opts?: {
    limit?: number
    sort?: string
    cursor?: string
  }): Promise<SkillBrowseResult> {
    const limit = opts?.limit ?? 20
    const sort = opts?.sort ?? 'trending'
    const params = new URLSearchParams({ sort, limit: String(limit) })
    if (opts?.cursor) params.set('cursor', opts.cursor)
    const url = `${this.baseUrl}/api/v1/skills?${params.toString()}`
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`ClawHub browse failed: HTTP ${res.status}`)
    const data = (await res.json()) as {
      items?: SkillBrowseItem[]
      skills?: SkillBrowseItem[]
      nextCursor?: string | null
      cursor?: string | null
    }
    const items = data.items ?? data.skills ?? []
    const nextCursor = data.nextCursor ?? data.cursor ?? null
    return { items, nextCursor }
  }

  async download(slug: string, version = 'latest'): Promise<Buffer> {
    const url = `${this.baseUrl}/api/v1/download?slug=${encodeURIComponent(slug)}&tag=${encodeURIComponent(version)}`
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(60000) })
    if (!res.ok) throw new Error(`ClawHub download failed: HTTP ${res.status}`)
    const arrayBuffer = await res.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }
}

// ========== SkillHub 实现（腾讯云 skillhub.cn 官方 API） ==========

interface SkillHubApiSkill {
  slug: string
  name?: string
  displayName?: string
  description?: string
  description_zh?: string
  summary?: string
  version?: string
  downloads?: number
  stars?: number
  score?: number
  updated_at?: number | string
  updatedAt?: number | string
  namespace?: { handle?: string; publicSlug?: string; canonicalName?: string }
}

/** UI sort → SkillHub API sortBy / order */
function mapSkillHubSort(sort: string): { sortBy: string; order: string } {
  switch (sort) {
    case 'stars':
      return { sortBy: 'stars', order: 'desc' }
    case 'updated':
      return { sortBy: 'updated_at', order: 'desc' }
    case 'downloads':
    case 'trending':
    default:
      return { sortBy: 'downloads', order: 'desc' }
  }
}

function skillHubUpdatedAt(item: SkillHubApiSkill): number {
  const raw = item.updated_at ?? item.updatedAt
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw) {
    const n = Number(raw)
    if (!Number.isNaN(n) && n > 1e11) return n
    const t = new Date(raw).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  return 0
}

function mapSkillHubBrowseItem(item: SkillHubApiSkill): SkillBrowseItem {
  return {
    slug: item.slug,
    displayName: item.displayName ?? item.name ?? item.slug,
    summary: item.description_zh ?? item.description ?? item.summary ?? '',
    stats: {
      downloads: item.downloads,
      stars: item.stars,
    },
    updatedAt: skillHubUpdatedAt(item),
    latestVersion: item.version ? { version: item.version } : undefined,
  }
}

export class SkillHubMarketplace implements SkillMarketplace {
  readonly id = 'skillhub'
  readonly name = 'SkillHub (腾讯)'
  readonly baseUrl = 'https://api.skillhub.cn'

  async search(query: string, opts?: { limit?: number }): Promise<SkillSearchResult[]> {
    const limit = opts?.limit ?? 20
    const url = `${this.baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`SkillHub search failed: HTTP ${res.status}`)
    const data = (await res.json()) as { results?: SkillHubApiSkill[] }
    return (data.results ?? []).map((item) => ({
      slug: item.slug,
      displayName: item.displayName ?? item.name ?? item.slug,
      summary: item.description_zh ?? item.summary ?? item.description ?? '',
      version: item.version ?? '',
      updatedAt: skillHubUpdatedAt(item),
      score: item.score,
    }))
  }

  async browse(opts?: {
    limit?: number
    sort?: string
    cursor?: string
  }): Promise<SkillBrowseResult> {
    const pageSize = opts?.limit ?? 20
    const page = opts?.cursor ? Math.max(1, parseInt(opts.cursor, 10) || 1) : 1
    const { sortBy, order } = mapSkillHubSort(opts?.sort ?? 'trending')

    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy,
      order,
    })
    const url = `${this.baseUrl}/api/skills?${params.toString()}`
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`SkillHub browse failed: HTTP ${res.status}`)
    const data = (await res.json()) as {
      code?: number
      message?: string
      data?: { skills?: SkillHubApiSkill[]; total?: number }
    }
    if (data.code != null && data.code !== 0) {
      throw new Error(`SkillHub browse failed: ${data.message ?? `code ${data.code}`}`)
    }

    const skills = data.data?.skills ?? []
    const total = data.data?.total ?? 0
    const items = skills.map(mapSkillHubBrowseItem)
    const loaded = (page - 1) * pageSize + skills.length
    const nextCursor = loaded < total && skills.length > 0 ? String(page + 1) : null

    return { items, nextCursor }
  }

  async download(slug: string, version?: string): Promise<Buffer> {
    const params = new URLSearchParams({ slug })
    if (version && version !== 'latest') params.set('version', version)
    const url = `${this.baseUrl}/api/v1/download?${params.toString()}`
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(60000) })
    if (!res.ok) throw new Error(`SkillHub download failed: HTTP ${res.status} for ${slug}`)
    return Buffer.from(await res.arrayBuffer())
  }
}

// ========== FindSkill 实现（skills.volces.com） ==========

interface FindSkillItem {
  Slug: string
  Name: string
  Description: string
  UpdatedAt: string
}

interface FindSkillResponse {
  Skills: FindSkillItem[]
  NextPageToken: string
}

/** FindSkill 全量索引内存缓存（约 1.3MB，有效期 10 分钟） */
let findSkillIndexCache: FindSkillItem[] | null = null
let findSkillIndexFetchedAt = 0
const FINDSKILL_INDEX_TTL = 10 * 60 * 1000

function mapFindSkillItem(item: FindSkillItem): SkillBrowseItem {
  return {
    slug: item.Slug,
    displayName: item.Name,
    summary: item.Description,
    stats: {},
    updatedAt: item.UpdatedAt ? new Date(item.UpdatedAt).getTime() : 0,
  }
}

export class FindSkillMarketplace implements SkillMarketplace {
  readonly id = 'findskill'
  readonly name = 'FindSkill'
  readonly baseUrl = 'https://skills.volces.com'

  async search(query: string, opts?: { limit?: number }): Promise<SkillSearchResult[]> {
    const limit = opts?.limit ?? 20
    const url = `${this.baseUrl}/v1/skills?query=${encodeURIComponent(query)}`
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`FindSkill search failed: HTTP ${res.status}`)
    const data = (await res.json()) as FindSkillResponse
    return (data.Skills ?? []).slice(0, limit).map((item) => ({
      slug: item.Slug,
      displayName: item.Name,
      summary: item.Description,
      version: '',
      updatedAt: item.UpdatedAt ? new Date(item.UpdatedAt).getTime() : 0,
    }))
  }

  async browse(opts?: {
    limit?: number
    sort?: string
    cursor?: string
  }): Promise<SkillBrowseResult> {
    const limit = opts?.limit ?? 20
    const sort = opts?.sort ?? 'trending'
    const offset = opts?.cursor ? parseInt(opts.cursor, 10) : 0

    const index = await this.loadIndex()

    // FindSkill 暂无 stats，仅支持按 updated 排序
    const sorted =
      sort === 'updated'
        ? [...index].sort((a, b) => {
            const ta = a.UpdatedAt ? new Date(a.UpdatedAt).getTime() : 0
            const tb = b.UpdatedAt ? new Date(b.UpdatedAt).getTime() : 0
            return tb - ta
          })
        : index

    const page = sorted.slice(offset, offset + limit)
    const nextOffset = offset + limit
    const nextCursor = nextOffset < sorted.length ? String(nextOffset) : null

    return { items: page.map(mapFindSkillItem), nextCursor }
  }

  async download(slug: string): Promise<Buffer> {
    // slug 格式：clawhub/author/name → 直接拼路径
    const url = `${this.baseUrl}/v1/skills/download/${slug}`
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(60000) })
    if (!res.ok) throw new Error(`FindSkill download failed: HTTP ${res.status} for ${slug}`)
    return Buffer.from(await res.arrayBuffer())
  }

  /** 加载全量索引，内存缓存 10 分钟 */
  private async loadIndex(): Promise<FindSkillItem[]> {
    const now = Date.now()
    if (findSkillIndexCache && now - findSkillIndexFetchedAt < FINDSKILL_INDEX_TTL) {
      return findSkillIndexCache
    }
    const url = `${this.baseUrl}/v1/skills`
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(60000) })
    if (!res.ok) throw new Error(`FindSkill index fetch failed: HTTP ${res.status}`)
    const data = (await res.json()) as FindSkillResponse
    if (!Array.isArray(data.Skills)) throw new Error('FindSkill index: invalid format')
    findSkillIndexCache = data.Skills
    findSkillIndexFetchedAt = now
    return findSkillIndexCache
  }
}

// ========== 市场注册表 ==========

const marketplaces: SkillMarketplace[] = [
  new SkillHubMarketplace(),
  new ClawHubMarketplace(),
  new FindSkillMarketplace(),
]

export function getMarketplaces(): SkillMarketplace[] {
  return marketplaces
}

export function getMarketplace(id: string): SkillMarketplace | undefined {
  return marketplaces.find((m) => m.id === id)
}
