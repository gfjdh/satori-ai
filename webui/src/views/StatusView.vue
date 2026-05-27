<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { dialogueApi, logApi, skillApi, stateApi, taskApi } from '@/api'
import type { Dialogue, LogEntry, SkillMeta, State, Task } from '@/api'
import { ElMessage, ElMessageBox } from 'element-plus'

const logCategories = [
  { label: '全部日志', value: '' },
  { label: 'Agent', value: 'agent' },
  { label: 'API 调用', value: 'api_call' },
  { label: '屏幕分析', value: 'screen_analysis' },
  { label: '心跳', value: 'heartbeat' },
  { label: '任务', value: 'task' },
  { label: '错误', value: 'error' }
]

const dialogues = ref<Dialogue[]>([])
const logs = ref<LogEntry[]>([])
const skills = ref<SkillMeta[]>([])
const tasks = ref<Task[]>([])
const state = ref<State | null>(null)

const isLoading = ref(true)
const lastRefresh = ref(new Date())
const filterCategory = ref('')
const selectedLog = ref<LogEntry | null>(null)
const logDialogVisible = computed({
  get: () => selectedLog.value !== null,
  set: (value: boolean) => {
    if (!value) {
      selectedLog.value = null
    }
  }
})

const activeTasksCount = computed(() => tasks.value.filter((task) => task.enabled).length)
const dueTasksCount = computed(() => tasks.value.filter((task) => getTaskStatus(task) === 'due').length)
const recentErrorCount = computed(() => logs.value.filter((log) => log.level === 'error').length)

const affinityMetrics = computed(() =>
  Object.entries(state.value?.affinity.dimensions ?? {}).map(([name, value]) => ({
    name,
    value: Number(value)
  }))
)

const emotionMetrics = computed(() =>
  Object.entries(state.value?.emotion.dimensions ?? {}).map(([name, value]) => ({
    name,
    value: Number(value),
    percent: Math.max(0, Math.min(100, (Number(value) + 100) / 2))
  }))
)

const latestDialogues = computed(() => dialogues.value.slice(0, 8))

const summaryCards = computed(() => [
  {
    key: 'skills',
    label: '已加载技能',
    value: skills.value.length,
  },
  {
    key: 'dialogues',
    label: '对话记录',
    value: dialogues.value.length,
  },
  {
    key: 'tasks',
    label: '启用任务',
    value: `${activeTasksCount.value}/${tasks.value.length}`,
  },
  {
    key: 'errors',
    label: '错误日志',
    value: recentErrorCount.value,
  }
])

async function loadData() {
  isLoading.value = true
  try {
    const [dialogueRes, logRes, skillRes, taskRes, stateRes] = await Promise.all([
      stateApi.getDialogues(50),
      logApi.getRecent(200, filterCategory.value || undefined),
      skillApi.getAll(),
      taskApi.getAll(),
      stateApi.get()
    ])

    dialogues.value = dialogueRes.data || []
    logs.value = logRes.data || []
    skills.value = skillRes.data || []
    tasks.value = taskRes.data || []
    state.value = stateRes.data || null
    lastRefresh.value = new Date()
  } catch (error) {
    console.error('Failed to load data:', error)
    ElMessage.error('状态数据加载失败')
  } finally {
    isLoading.value = false
  }
}

function formatTime(date: Date | string): string {
  const value = typeof date === 'string' ? new Date(date) : date
  return value.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatDateTime(date: Date | string | null): string {
  if (!date) return '暂无记录'
  const value = typeof date === 'string' ? new Date(date) : date
  return value.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatSnippet(text: string, maxLength = 120): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function getLogTagType(level: LogEntry['level']): 'primary' | 'warning' | 'danger' | 'info' {
  if (level === 'error') return 'danger'
  if (level === 'warn') return 'warning'
  if (level === 'debug') return 'info'
  return 'primary'
}

function getTaskStatus(task: Task): 'disabled' | 'due' | 'scheduled' {
  if (!task.enabled) return 'disabled'
  if (new Date(task.nextRun).getTime() <= Date.now()) return 'due'
  return 'scheduled'
}

function getTaskStatusLabel(task: Task): string {
  const status = getTaskStatus(task)
  if (status === 'disabled') return '已停用'
  if (status === 'due') return '待执行'
  return '已排程'
}

function getTaskTagType(task: Task): 'success' | 'warning' | 'info' {
  const status = getTaskStatus(task)
  if (status === 'due') return 'warning'
  if (status === 'disabled') return 'info'
  return 'success'
}

function refresh() {
  loadData()
}

async function flushLogs() {
  try {
    await logApi.flush()
    ElMessage.success('日志已导出到 data/logs 目录')
  } catch (error) {
    console.error('Failed to flush logs:', error)
    ElMessage.error('日志导出失败')
  }
}

async function clearLogs() {
  try {
    await ElMessageBox.confirm('确定清空当前所有系统日志吗？', '清空日志', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消'
    })
    await logApi.clear()
    logs.value = []
    ElMessage.success('日志已清空')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to clear logs:', error)
      ElMessage.error('清空日志失败')
    }
  }
}

async function clearDialogues() {
  try {
    await ElMessageBox.confirm('确定清空所有对话记录吗？', '清空对话', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消'
    })
    await dialogueApi.clear()
    dialogues.value = []
    ElMessage.success('对话记录已清空')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to clear dialogues:', error)
      ElMessage.error('清空对话失败')
    }
  }
}

function viewLog(log: LogEntry) {
  selectedLog.value = log
}

let autoRefreshTimer: number | null = null

onMounted(() => {
  loadData()
  autoRefreshTimer = window.setInterval(() => {
    loadData()
  }, 30000)
})

onUnmounted(() => {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer)
  }
})
</script>

<template>
  <div class="status-view">
    <section class="hero-panel">
      <div class="hero-copy">
        <h1>系统状态总览</h1>
        <div class="hero-meta">
          <span>最近刷新 {{ formatTime(lastRefresh) }}</span>
          <span>自动刷新间隔 30 秒</span>
          <span v-if="state">情绪回归速率 {{ state.emotion.regressionRate }}</span>
        </div>
      </div>

      <div class="hero-actions">
        <el-button type="primary" :loading="isLoading" @click="refresh">
          刷新数据
        </el-button>
      </div>
    </section>

    <section class="summary-grid">
      <el-card
        v-for="card in summaryCards"
        :key="card.key"
        shadow="hover"
        class="summary-card"
      >
        <div class="summary-label">{{ card.label }}</div>
        <div class="summary-value">{{ card.value }}</div>
      </el-card>
    </section>

    <section class="content-grid">
      <el-card class="state-card panel-card" shadow="never">
        <template #header>
          <div class="panel-header">
            <div>
              <h3>角色状态</h3>
            </div>
            <el-tag v-if="state" type="success" effect="plain">在线</el-tag>
          </div>
        </template>

        <div v-if="state" class="state-metrics">
          <div class="metric-group">
            <div class="metric-title">亲和度</div>
            <div class="metric-stack">
              <div v-for="metric in affinityMetrics" :key="metric.name" class="metric-row">
                <div class="metric-label">
                  <span>{{ metric.name }}</span>
                  <strong>{{ metric.value }}</strong>
                </div>
                <el-progress
                  :percentage="metric.value"
                  :show-text="false"
                  color="#f26b3a"
                  :stroke-width="10"
                />
              </div>
            </div>
          </div>

          <div class="metric-group">
            <div class="metric-title">情绪波动</div>
            <div class="metric-stack">
              <div v-for="metric in emotionMetrics" :key="metric.name" class="metric-row">
                <div class="metric-label">
                  <span>{{ metric.name }}</span>
                  <strong>{{ metric.value }}</strong>
                </div>
                <el-progress
                  :percentage="metric.percent"
                  :show-text="false"
                  color="#2f7df6"
                  :stroke-width="10"
                />
              </div>
            </div>
          </div>
        </div>
        <el-empty v-else description="状态数据加载中" />
      </el-card>

      <el-card class="tasks-card panel-card" shadow="never">
        <template #header>
          <div class="panel-header">
            <div>
              <h3>定时任务</h3>
              <p>{{ activeTasksCount }} 个任务正在运行</p>
            </div>
            <el-tag type="warning" effect="plain">{{ dueTasksCount }} 待执行</el-tag>
          </div>
        </template>

        <div v-if="tasks.length" class="task-list">
          <div
            v-for="task in tasks"
            :key="task.id"
            class="task-item"
            :class="`task-${getTaskStatus(task)}`"
          >
            <div class="task-main">
              <div class="task-title-row">
                <strong>{{ task.name }}</strong>
                <el-tag size="small" :type="getTaskTagType(task)">
                  {{ getTaskStatusLabel(task) }}
                </el-tag>
              </div>
              <div class="task-subtitle">{{ task.actionType }} · {{ task.cron }}</div>
            </div>
            <div class="task-side">
              <span>下次执行</span>
              <strong>{{ formatDateTime(task.nextRun) }}</strong>
              <small>上次执行 {{ formatDateTime(task.lastRun) }}</small>
            </div>
          </div>
        </div>
        <el-empty v-else description="暂无定时任务" />
      </el-card>

      <el-card class="skills-card panel-card" shadow="never">
        <template #header>
          <div class="panel-header">
            <div>
              <h3>技能清单</h3>
            </div>
          </div>
        </template>

        <div v-if="skills.length" class="skill-list">
          <div v-for="skill in skills" :key="skill.name" class="skill-item">
            <div class="skill-top">
              <strong>{{ skill.name }}</strong>
              <el-tag size="small" effect="plain">{{ skill.version || 'latest' }}</el-tag>
            </div>
            <p>{{ skill.description || '暂无描述' }}</p>
            <span>{{ skill.author || 'Unknown Author' }}</span>
          </div>
        </div>
        <el-empty v-else description="暂无技能信息" />
      </el-card>

      <el-card class="dialogue-card panel-card" shadow="never">
        <template #header>
          <div class="panel-header panel-header-actions">
            <div>
              <h3>最近对话</h3>
            </div>
            <div class="dialogue-toolbar">
              <el-tag effect="plain">{{ dialogues.length }} 条</el-tag>
              <el-button size="small" type="danger" plain @click="clearDialogues">
                清空对话
              </el-button>
            </div>
          </div>
        </template>

        <div v-if="latestDialogues.length" class="dialogue-list">
          <div v-for="dialogue in latestDialogues" :key="dialogue.id" class="dialogue-item">
            <div class="dialogue-top">
              <el-tag size="small" type="info" effect="plain">#{{ dialogue.turnIndex }}</el-tag>
              <span>{{ formatDateTime(dialogue.createdAt) }}</span>
            </div>
            <div class="dialogue-bubble user">
              <label>User</label>
              <p>{{ dialogue.userContent }}</p>
            </div>
            <div class="dialogue-bubble ai">
              <label>Assistant</label>
              <p>{{ dialogue.aiContent }}</p>
            </div>
          </div>
        </div>
        <el-empty v-else description="暂无对话记录" />
      </el-card>
    </section>

    <el-card class="logs-card panel-card" shadow="never">
      <template #header>
        <div class="panel-header panel-header-actions">
          <div>
            <h3>系统日志</h3>
          </div>
          <div class="logs-toolbar">
            <el-select
              v-model="filterCategory"
              class="log-filter-select"
              placeholder="选择日志分类"
              size="small"
              @change="loadData"
            >
              <el-option
                v-for="option in logCategories"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
            <el-tag effect="plain">{{ logs.length }} 条</el-tag>
            <el-button size="small" @click="flushLogs">导出日志</el-button>
            <el-button size="small" type="danger" plain @click="clearLogs">
              清空日志
            </el-button>
          </div>
        </div>
      </template>

      <el-table
        v-if="logs.length"
        :data="logs"
        stripe
        class="logs-table"
        height="420"
      >
        <el-table-column label="时间" width="180">
          <template #default="{ row }">
            {{ formatDateTime(row.createdAt) }}
          </template>
        </el-table-column>

        <el-table-column label="级别" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="getLogTagType(row.level)">
              {{ row.level.toUpperCase() }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="category" label="分类" width="140" />

        <el-table-column label="内容" min-width="420">
          <template #default="{ row }">
            <div class="log-snippet" @click="viewLog(row)">
              {{ formatSnippet(row.content) }}
            </div>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="暂无日志数据" />
    </el-card>

    <el-dialog
      v-model="logDialogVisible"
      title="日志详情"
      width="760px"
      destroy-on-close
      :show-close="true"
    >
      <template v-if="selectedLog">
        <div class="log-detail-meta">
          <el-tag size="small" :type="getLogTagType(selectedLog.level)">
            {{ selectedLog.level.toUpperCase() }}
          </el-tag>
          <el-tag size="small" effect="plain">{{ selectedLog.category }}</el-tag>
          <span>{{ formatDateTime(selectedLog.createdAt) }}</span>
        </div>
        <pre class="log-detail-content">{{ selectedLog.content }}</pre>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.status-view {
  --surface: rgba(255, 255, 255, 0.86);
  --border: rgba(255, 255, 255, 0.72);
  --text-main: #162033;
  --text-subtle: #6a7486;
  --accent: #ff6b9d;
  --accent-soft: #fce4ec;
  --blue-soft: #d7ebff;
  padding: 8px 0 28px;
  color: var(--text-main);
}

.hero-panel {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 28px;
  border-radius: 28px;
  background: #f7f9fc;
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 20px 50px rgba(33, 50, 90, 0.12);
}

.hero-copy {
  max-width: 760px;
}

.hero-kicker {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hero-copy h1 {
  margin: 14px 0 12px;
  font-size: 32px;
  line-height: 1.1;
}

.hero-copy p {
  max-width: 620px;
  margin: 0;
  color: var(--text-subtle);
  line-height: 1.7;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.hero-meta span {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.74);
  color: #435066;
  font-size: 13px;
}

.hero-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 220px;
  flex-shrink: 0;
}

.category-select {
  width: 100%;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
  margin-top: 22px;
}

.summary-card {
  border-radius: 22px;
  border: 1px solid var(--border);
  background: var(--surface);
  backdrop-filter: blur(16px);
}

.summary-label {
  font-size: 13px;
  color: var(--text-subtle);
}

.summary-value {
  margin-top: 12px;
  font-size: 32px;
  font-weight: 700;
  line-height: 1;
}

.summary-note {
  margin-top: 10px;
  color: #4f5c73;
  font-size: 13px;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 1fr);
  gap: 18px;
  margin-top: 22px;
}

.panel-card {
  border-radius: 24px;
  border: 1px solid var(--border);
  background: var(--surface);
  backdrop-filter: blur(16px);
}

.state-card {
  min-height: 380px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-header-actions {
  align-items: flex-start;
}

.panel-header h3 {
  margin: 0;
  font-size: 18px;
}

.panel-header p {
  margin: 6px 0 0;
  color: var(--text-subtle);
  font-size: 13px;
}

.state-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
}

.metric-group {
  padding: 20px;
  border-radius: 20px;
  background: rgba(245, 248, 253, 0.92);
  border: 1px solid rgba(225, 233, 244, 0.9);
}

.metric-title {
  margin-bottom: 18px;
  font-size: 15px;
  font-weight: 700;
}

.metric-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.metric-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.metric-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.metric-label span {
  color: #49556a;
}

.metric-label strong {
  font-size: 14px;
}

.task-list,
.skill-list,
.dialogue-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dialogue-list {
  max-height: 480px;
  overflow-y: auto;
  padding-right: 4px;
}

.task-item,
.skill-item,
.dialogue-item {
  border-radius: 18px;
  border: 1px solid rgba(226, 233, 244, 0.92);
  background: rgba(255, 255, 255, 0.94);
}

.task-item {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
}

.task-due {
  box-shadow: inset 0 0 0 1px rgba(242, 107, 58, 0.18);
  background: #fff8f3;
}

.task-disabled {
  opacity: 0.68;
}

.task-main,
.task-side {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.task-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.task-subtitle,
.task-side span,
.task-side small,
.skill-item span,
.dialogue-top span {
  color: var(--text-subtle);
  font-size: 12px;
}

.task-side {
  min-width: 180px;
  text-align: right;
}

.skill-item,
.dialogue-item {
  padding: 16px;
}

.skill-top,
.dialogue-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.skill-item p {
  margin: 10px 0 8px;
  color: #445066;
  line-height: 1.6;
}

.dialogue-item {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dialogue-bubble {
  padding: 14px 16px;
  border-radius: 16px;
}

.dialogue-bubble label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dialogue-bubble p {
  margin: 0;
  line-height: 1.65;
  word-break: break-word;
}

.dialogue-bubble.user {
  background: #e3f2fd;
}

.dialogue-bubble.user label {
  color: #2196f3;
}

.dialogue-bubble.ai {
  background: #fce4ec;
}

.dialogue-bubble.ai label {
  color: var(--accent);
}

.logs-card {
  margin-top: 18px;
}

.logs-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.dialogue-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.log-filter-select {
  width: 168px;
}

.logs-table {
  width: 100%;
}

.log-snippet {
  cursor: pointer;
  color: #344055;
  line-height: 1.6;
}

.log-snippet:hover {
  color: var(--accent);
}

.log-detail-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
  color: var(--text-subtle);
  font-size: 13px;
}

.log-detail-content {
  margin: 0;
  padding: 18px;
  border-radius: 16px;
  background: #f5f8fc;
  color: #263246;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 460px;
  overflow: auto;
}

@media (max-width: 1200px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .hero-panel {
    flex-direction: column;
  }

  .hero-actions {
    width: 100%;
  }

  .state-metrics {
    grid-template-columns: 1fr;
  }

  .panel-header-actions {
    flex-direction: column;
  }

  .logs-toolbar {
    width: 100%;
  }

  .dialogue-toolbar {
    width: 100%;
  }

  .log-filter-select {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .status-view {
    padding-top: 0;
  }

  .hero-panel {
    padding: 22px;
    border-radius: 22px;
  }

  .hero-copy h1 {
    font-size: 28px;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }

  .task-item {
    flex-direction: column;
  }

  .task-side {
    min-width: auto;
    text-align: left;
  }
}
</style>
