<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { stateApi, logApi, skillApi, taskApi, dialogueApi } from '@/api'
import type { Dialogue, LogEntry, SkillMeta, Task } from '@/api'

// 数据
const dialogues = ref<Dialogue[]>([])
const logs = ref<LogEntry[]>([])
const skills = ref<SkillMeta[]>([])
const tasks = ref<Task[]>([])
const state = ref<any>(null)
const tokenUsage = ref({ prompt: 0, completion: 0, total: 0 })

// 状态
const isLoading = ref(true)
const lastRefresh = ref<Date>(new Date())
const filterCategory = ref<string>('')

// 日志详情弹窗
const selectedLog = ref<LogEntry | null>(null)

// 加载所有数据
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
    state.value = stateRes.data
    lastRefresh.value = new Date()
  } catch (e) {
    console.error('Failed to load data:', e)
  }
  isLoading.value = false
}

// 格式化时间
function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('zh-CN')
}

// 获取日志级别样式
function getLogLevelClass(level: string): string {
  return `log-${level}`
}

// 获取任务状态样式
function getTaskStatus(task: Task): string {
  if (!task.enabled) return 'disabled'
  const nextRun = new Date(task.nextRun)
  if (nextRun <= new Date()) return 'due'
  return 'scheduled'
}

// 刷新数据
function refresh() {
  loadData()
}

// 导出日志到文件
async function flushLogs() {
  try {
    await logApi.flush()
    alert('日志已导出到 data/logs/ 目录')
  } catch (e) {
    console.error('Failed to flush logs:', e)
    alert('日志导出失败')
  }
}

// 清除日志
async function clearLogs() {
  if (!confirm('确定清除所有日志？')) return
  try {
    await logApi.clear()
    logs.value = []
  } catch (e) {
    console.error('Failed to clear logs:', e)
  }
}

// 查看日志详情
function viewLog(log: LogEntry) {
  selectedLog.value = log
}

function closeLogDetail() {
  selectedLog.value = null
}

// 清除对话
async function clearDialogues() {
  if (!confirm('确定清除所有对话记录？')) return
  try {
    await dialogueApi.clear()
    dialogues.value = []
  } catch (e) {
    console.error('Failed to clear dialogues:', e)
  }
}

// 自动刷新
let autoRefreshTimer: number | null = null

onMounted(() => {
  loadData()
  // 每30秒自动刷新
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
    <div class="status-header">
      <h2>状态面板</h2>
      <div class="header-actions">
        <select v-model="filterCategory" @change="loadData">
          <option value="">全部日志</option>
          <option value="agent">Agent</option>
          <option value="api_call">API调用</option>
          <option value="screen_analysis">屏幕分析</option>
          <option value="heartbeat">心跳</option>
          <option value="task">任务</option>
          <option value="error">错误</option>
        </select>
        <span class="last-refresh">最后刷新: {{ formatTime(lastRefresh) }}</span>
        <button @click="refresh" :disabled="isLoading">
          {{ isLoading ? '刷新中...' : '刷新' }}
        </button>
        <button @click="flushLogs" class="btn-flush">导出日志</button>
        <button @click="clearLogs" class="btn-danger">清空日志</button>
        <button @click="clearDialogues" class="btn-danger">清空对话</button>
      </div>
    </div>

    <!-- 概览卡片 -->
    <div class="overview-cards">
      <div class="overview-card">
        <div class="card-title">当前状态</div>
        <div class="card-content" v-if="state">
          <div class="state-item">
            <span class="label">情绪回归速率:</span>
            <span class="value">{{ state.emotion.regressionRate }}</span>
          </div>
        </div>
        <div class="card-content empty" v-else>加载中...</div>
      </div>

      <div class="overview-card">
        <div class="card-title">Skills</div>
        <div class="card-content">
          <div class="stat">{{ skills.length }} 个已加载</div>
        </div>
      </div>

      <div class="overview-card">
        <div class="card-title">对话轮次</div>
        <div class="card-content">
          <div class="stat">{{ dialogues.length }} 条记录</div>
        </div>
      </div>

      <div class="overview-card">
        <div class="card-title">定时任务</div>
        <div class="card-content">
          <div class="stat">{{ tasks.filter(t => t.enabled).length }} / {{ tasks.length }} 启用</div>
        </div>
      </div>
    </div>

    <!-- 详情区域 -->
    <div class="detail-sections">
      <!-- 状态详情 -->
      <div class="detail-section state-section" v-if="state">
        <h3>状态详情</h3>
        <div class="section-content">
          <div class="state-group">
            <h4>好感度</h4>
            <div class="dimensions">
              <div v-for="(value, key) in state.affinity.dimensions" :key="key" class="dimension">
                <span class="dim-name">{{ key }}</span>
                <div class="dim-bar">
                  <div class="dim-fill affinity" :style="{ width: value + '%' }"></div>
                </div>
                <span class="dim-value">{{ value }}</span>
              </div>
            </div>
          </div>
          <div class="state-group">
            <h4>情绪</h4>
            <div class="dimensions">
              <div v-for="(value, key) in state.emotion.dimensions" :key="key" class="dimension">
                <span class="dim-name">{{ key }}</span>
                <div class="dim-bar">
                  <div class="dim-fill emotion" :style="{ width: ((value + 100) / 2) + '%' }"></div>
                </div>
                <span class="dim-value">{{ value }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 定时任务 -->
      <div class="detail-section tasks-section">
        <h3>定时任务 ({{ tasks.length }})</h3>
        <div class="tasks-list" v-if="tasks.length > 0">
          <div v-for="task in tasks" :key="task.id" class="task-item" :class="getTaskStatus(task)">
            <div class="task-info">
              <span class="task-name">{{ task.name }}</span>
              <span class="task-cron">{{ task.cron }}</span>
            </div>
            <div class="task-meta">
              <span class="task-type">{{ task.actionType }}</span>
              <span class="task-next">下次: {{ formatTime(task.nextRun) }}</span>
            </div>
            <div class="task-status">
              <span class="status-badge">{{ task.enabled ? '启用' : '禁用' }}</span>
            </div>
          </div>
        </div>
        <div class="empty-section" v-else>暂无定时任务</div>
      </div>

      <!-- Skills 列表 -->
      <div class="detail-section skills-section">
        <h3>已加载 Skills ({{ skills.length }})</h3>
        <div class="skills-grid">
          <div v-for="skill in skills" :key="skill.name" class="skill-card">
            <div class="skill-name">{{ skill.name }}</div>
            <div class="skill-desc">{{ skill.description }}</div>
          </div>
        </div>
      </div>

      <!-- 最新对话 -->
      <div class="detail-section dialogue-section">
        <h3>最新对话 ({{ dialogues.length }})</h3>
        <div class="dialogue-list">
          <div v-for="dialog in dialogues.slice(0, 10)" :key="dialog.id" class="dialogue-item">
            <div class="dialogue-turn">#{{ dialog.turnIndex }}</div>
            <div class="dialogue-content">
              <div class="user-text">{{ dialog.userContent }}</div>
              <div class="ai-text">{{ dialog.aiContent }}</div>
            </div>
            <div class="dialogue-time">{{ formatTime(dialog.createdAt) }}</div>
          </div>
        </div>
        <div class="empty-section" v-if="dialogues.length === 0">暂无对话记录</div>
      </div>

      <!-- 系统日志 -->
      <div class="detail-section logs-section">
        <h3>系统日志 ({{ logs.length }})</h3>
        <div class="logs-table">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>级别</th>
                <th>分类</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="log in logs" :key="log.id" :class="getLogLevelClass(log.level)">
                <td class="log-time">{{ formatTime(log.createdAt) }}</td>
                <td class="log-level">
                  <span class="level-badge" :class="log.level">{{ log.level }}</span>
                </td>
                <td class="log-category">{{ log.category }}</td>
                <td class="log-content" @click="viewLog(log)">{{ log.content }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="empty-section" v-if="logs.length === 0">暂无日志</div>
      </div>
    </div>

    <!-- 日志详情弹窗 -->
    <div v-if="selectedLog" class="modal-overlay" @click.self="closeLogDetail">
      <div class="modal">
        <div class="modal-header">
          <h3>日志详情</h3>
          <button class="modal-close" @click="closeLogDetail">&times;</button>
        </div>
        <div class="modal-body">
          <div class="modal-meta">
            <span class="level-badge" :class="selectedLog.level">{{ selectedLog.level }}</span>
            <span>{{ selectedLog.category }}</span>
            <span>{{ formatTime(selectedLog.createdAt) }}</span>
          </div>
          <pre class="modal-content">{{ selectedLog.content }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.status-view {
  max-width: 1400px;
}

.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.status-header h2 {
  font-size: 22px;
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.header-actions select {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
  font-size: 13px;
}

.last-refresh {
  font-size: 12px;
  color: #999;
}

.header-actions button {
  padding: 8px 16px;
  background: #ff6b9d;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.header-actions button:disabled {
  background: #ccc;
}

.btn-danger {
  background: #f44336 !important;
}

.btn-flush {
  background: #4caf50 !important;
}

.btn-danger:hover {
  background: #d32f2f !important;
}

.btn-flush:hover {
  background: #388e3c !important;
}

/* Overview Cards */
.overview-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.overview-card {
  background: white;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.card-title {
  font-size: 13px;
  color: #888;
  margin-bottom: 8px;
}

.stat {
  font-size: 24px;
  font-weight: 600;
  color: #333;
}

.card-content .state-item {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

.card-content .state-item .label {
  color: #666;
}

.card-content.empty {
  color: #999;
}

/* Detail Sections */
.detail-sections {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.detail-section {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.detail-section h3 {
  font-size: 16px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #eee;
}

.section-content {
  display: flex;
  gap: 40px;
}

.state-group h4 {
  font-size: 13px;
  color: #888;
  margin-bottom: 10px;
}

.dimensions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dimension {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dim-name {
  width: 70px;
  font-size: 13px;
}

.dim-bar {
  flex: 1;
  height: 8px;
  background: #eee;
  border-radius: 4px;
  overflow: hidden;
  max-width: 200px;
}

.dim-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s;
}

.dim-fill.affinity {
  background: linear-gradient(90deg, #ff6b9d, #ff8a80);
}

.dim-fill.emotion {
  background: linear-gradient(90deg, #64b5f6, #81d4fa);
}

.dim-value {
  width: 40px;
  text-align: right;
  font-size: 13px;
  color: #666;
}

/* Tasks */
.tasks-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: #f9f9f9;
  border-radius: 8px;
}

.task-item.due {
  background: #fff3e0;
}

.task-item.disabled {
  opacity: 0.5;
}

.task-info {
  flex: 1;
}

.task-name {
  font-weight: 500;
  display: block;
}

.task-cron {
  font-size: 12px;
  color: #888;
}

.task-meta {
  text-align: center;
}

.task-type {
  font-size: 11px;
  color: #666;
  display: block;
}

.task-next {
  font-size: 12px;
  color: #333;
}

.status-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  background: #4caf50;
  color: white;
}

.task-item.disabled .status-badge {
  background: #999;
}

/* Skills */
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.skill-card {
  padding: 12px;
  background: #f9f9f9;
  border-radius: 8px;
}

.skill-name {
  font-weight: 500;
  margin-bottom: 4px;
}

.skill-desc {
  font-size: 12px;
  color: #666;
  margin-bottom: 8px;
}

.skill-keywords {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.keyword {
  padding: 2px 6px;
  background: #e3f2fd;
  border-radius: 4px;
  font-size: 10px;
  color: #1976d2;
}

/* Dialogues */
.dialogue-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dialogue-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: #f9f9f9;
  border-radius: 8px;
}

.dialogue-turn {
  font-size: 12px;
  color: #888;
  flex-shrink: 0;
}

.dialogue-content {
  flex: 1;
}

.user-text {
  font-size: 13px;
  color: #1976d2;
  margin-bottom: 4px;
}

.ai-text {
  font-size: 13px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.dialogue-time {
  font-size: 11px;
  color: #999;
  flex-shrink: 0;
}

/* Logs Table */
.logs-table {
  max-height: 400px;
  overflow-y: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #f0f0f0;
}

th {
  font-size: 12px;
  color: #888;
  font-weight: 500;
  position: sticky;
  top: 0;
  background: white;
}

td {
  font-size: 12px;
}

.log-time {
  color: #888;
  width: 80px;
}

.level-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  text-transform: uppercase;
}

.level-badge.info { background: #e3f2fd; color: #1976d2; }
.level-badge.warn { background: #fff3e0; color: #f57c00; }
.level-badge.error { background: #ffebee; color: #d32f2f; }
.level-badge.debug { background: #f5f5f5; color: #757575; }

.log-category {
  width: 100px;
}

.log-content {
  max-width: 500px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-section {
  color: #999;
  text-align: center;
  padding: 20px;
}

/* Modal */
.log-content {
  cursor: pointer;
}

.log-content:hover {
  background: #f5f5f5;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 800px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}

.modal-header h3 {
  font-size: 16px;
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #999;
}

.modal-close:hover {
  color: #333;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.modal-meta {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  font-size: 13px;
  color: #666;
}

.modal-content {
  background: #f9f9f9;
  padding: 16px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 500px;
  overflow-y: auto;
}
</style>
