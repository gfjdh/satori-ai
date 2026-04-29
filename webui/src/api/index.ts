import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
})

// 对话历史
export interface Dialogue {
  id: string
  turnIndex: number
  userContent: string
  aiContent: string
  createdAt: string
}

// 状态
export interface AffinityState {
  characterId: string
  dimensions: Record<string, number>
}

export interface EmotionState {
  characterId: string
  dimensions: Record<string, number>
  regressionRate: number
}

export interface State {
  affinity: AffinityState
  emotion: EmotionState
}

// 日志
export interface LogEntry {
  id: string
  level: 'info' | 'warn' | 'error' | 'debug'
  category: string
  content: string
  createdAt: string
}

// Skill
export interface SkillMeta {
  name: string
  description: string
  version?: string
  author?: string
}

// 任务
export interface Task {
  id: string
  name: string
  cron: string
  actionType: string
  params: Record<string, unknown>
  enabled: boolean
  lastRun: string | null
  nextRun: string
  createdAt: string
}

// API 响应类型
export interface ApiResponse<T> {
  data?: T
  error?: string
}

// 对话API
export const chatApi = {
  send: (message: string, characterId?: string) => {
    return api.post('/chat', { message, characterId })
  }
}

// 状态API
export const stateApi = {
  get: () => api.get<State>('/state'),
  getDialogues: (limit = 50) => api.get<Dialogue[]>('/dialogues', { params: { limit } })
}

// 日志API
export const logApi = {
  getRecent: (limit = 200, category?: string) => {
    return api.get<LogEntry[]>('/logs', { params: { limit, category } })
  },
  clear: () => api.delete('/logs')
}

// 对话API
export const dialogueApi = {
  clear: () => api.delete('/dialogues')
}

// Skills API
export const skillApi = {
  getAll: () => api.get<SkillMeta[]>('/skills')
}

// 任务API
export const taskApi = {
  getAll: () => api.get<Task[]>('/tasks')
}

// 健康检查
export const healthApi = {
  check: () => api.get('/health')
}

// 数据库管理 API
export interface ColumnInfo {
  name: string
  type: string
  primaryKey: boolean
  nullable: boolean
  defaultValue: string | null
}

export interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface TableData {
  columns: ColumnInfo[]
  data: Record<string, any>[]
  pagination: Pagination
}

export const dbApi = {
  getTables: () => api.get<string[]>('/db/tables'),

  getTableData: (tableName: string, options?: {
    page?: number
    pageSize?: number
    sort?: string
    order?: 'asc' | 'desc'
    filter?: string
  }) => {
    const params: Record<string, any> = {}
    if (options?.page) params.page = options.page
    if (options?.pageSize) params.pageSize = options.pageSize
    if (options?.sort) params.sort = options.sort
    if (options?.order) params.order = options.order
    if (options?.filter) params.filter = options.filter
    return api.get<TableData>(`/db/table/${tableName}`, { params })
  },

  updateRow: (tableName: string, id: string, data: Record<string, any>) => {
    return api.put(`/db/table/${tableName}/${id}`, data)
  },

  deleteRow: (tableName: string, id: string) => {
    return api.delete(`/db/table/${tableName}/${id}`)
  }
}

export default api
