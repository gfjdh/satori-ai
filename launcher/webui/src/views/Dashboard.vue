<template>
  <div>
    <h2>仪表盘</h2>

    <div class="card">
      <h3>环境状态</h3>
      <div class="env-grid">
        <div class="env-row">
          <span class="env-label">Node.js</span>
          <span :class="['env-status', env.node?.status]">
            {{ env.node?.status === 'ok' ? '✅' : env.node?.status === 'missing' ? '⚠️' : '❌' }}
          </span>
          <span class="env-version" v-if="env.node?.version">{{ env.node.version }}</span>
          <span class="env-hint" v-if="env.node?.hint">
            <a :href="env.node.hint" target="_blank">下载安装 →</a>
          </span>
        </div>

        <div v-for="(py, i) in env.python" :key="'py'+i" class="env-row">
          <span class="env-label">{{ i === 0 ? 'Python' : '' }}</span>
          <span :class="['env-status', py.status]">
            {{ py.status === 'ok' ? '✅' : py.status === 'missing' ? '⚠️' : '❌' }}
          </span>
          <span class="env-version" v-if="py.version">{{ py.version }}</span>
          <span class="env-path" v-if="py.path">{{ py.path }}</span>
          <span class="env-hint" v-if="py.hint">
            <a :href="py.hint" target="_blank">下载安装 →</a>
          </span>
        </div>

        <div class="env-row">
          <span class="env-label">Git</span>
          <span :class="['env-status', env.git?.status]">
            {{ env.git?.status === 'ok' ? '✅' : env.git?.status === 'missing' ? '⚠️' : '❌' }}
          </span>
          <span class="env-version" v-if="env.git?.version">{{ env.git.version }}</span>
          <span class="env-hint" v-if="env.git?.hint">
            <a :href="env.git.hint" target="_blank">下载安装 →</a>
          </span>
        </div>
      </div>
      <button class="btn btn-sm" @click="refreshEnv">刷新检测</button>
    </div>

    <div class="card">
      <h3>服务状态</h3>
      <div class="svc-grid">
        <div v-for="s in services" :key="s.name" class="svc-row">
          <span class="svc-dot" :class="s.status"></span>
          <span class="svc-name">{{ s.name }}</span>
          <span class="svc-port" v-if="s.port">:{{ s.port }}</span>
          <span class="svc-python" v-if="s.pythonVer">{{ s.pythonVer }}</span>
          <span class="svc-status-tag" :class="s.status">{{ statusText(s.status) }}</span>
        </div>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" @click="startAll" :disabled="loading">全部启动</button>
        <button class="btn btn-danger" @click="stopAll" :disabled="loading">全部停止</button>
        <button class="btn" @click="refreshServices">刷新</button>
      </div>
    </div>

    <div class="card">
      <h3>实时日志</h3>
      <div class="log-box" ref="logBox">
        <div v-for="(entry, i) in logs" :key="i" class="log-line">
          <span class="log-time">{{ entry.time }}</span>
          <span class="log-service">[{{ entry.service }}]</span>
          <span>{{ entry.line }}</span>
        </div>
        <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

const env = ref({ node: {}, python: [], git: {} })
const services = ref([])
const logs = ref([])
const loading = ref(false)
const logBox = ref(null)

let eventSource = null

function statusText(s) {
  return s === 'running' ? '运行中' : s === 'error' ? '异常' : '已停止'
}

async function refreshEnv() {
  const res = await fetch('/api/env')
  env.value = await res.json()
}

async function refreshServices() {
  const res = await fetch('/api/services')
  services.value = await res.json()
}

async function startAll() {
  loading.value = true
  await fetch('/api/services/start-all', { method: 'POST' })
  loading.value = false
  setTimeout(refreshServices, 2000)
}

async function stopAll() {
  loading.value = true
  await fetch('/api/services/stop-all', { method: 'POST' })
  loading.value = false
  setTimeout(refreshServices, 2000)
}

function connectLogs() {
  eventSource = new EventSource('/api/logs/stream')
  eventSource.onmessage = (e) => {
    const entry = JSON.parse(e.data)
    logs.value.push(entry)
    if (logs.value.length > 500) logs.value.shift()
    nextTick(() => {
      if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
    })
  }
}

onMounted(() => {
  refreshEnv()
  refreshServices()
  connectLogs()
})

onUnmounted(() => {
  if (eventSource) eventSource.close()
})
</script>

<style scoped>
h2 { font-size: 24px; margin-bottom: 20px; color: #fff; }
h3 { font-size: 14px; color: #888; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 1px; }
.card {
  background: #1a1a24; border-radius: 8px; padding: 20px; margin-bottom: 16px;
}
.env-grid { display: flex; flex-direction: column; gap: 8px; }
.env-row { display: flex; align-items: center; gap: 12px; font-size: 14px; flex-wrap: wrap; }
.env-label { width: 70px; color: #a0a0b8; }
.env-status { font-size: 16px; }
.env-version { color: #7c3aed; font-family: monospace; font-size: 13px; }
.env-path { color: #555; font-family: monospace; font-size: 11px; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.env-hint a { color: #f59e0b; font-size: 13px; }
.btn { padding: 8px 16px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; color: #e0e0e0; background: #2a2a36; }
.btn:hover { background: #3a3a48; }
.btn-sm { padding: 6px 12px; font-size: 12px; margin-top: 10px; }
.btn-primary { background: #7c3aed; }
.btn-primary:hover { background: #6d28d9; }
.btn-danger { background: #991b1b; }
.btn-danger:hover { background: #7f1d1d; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-group { display: flex; gap: 8px; margin-top: 14px; }
.svc-grid { display: flex; flex-direction: column; gap: 6px; }
.svc-row { display: flex; align-items: center; gap: 10px; font-size: 14px; }
.svc-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: #555; }
.svc-dot.running { background: #22c55e; }
.svc-dot.error { background: #ef4444; }
.svc-name { min-width: 80px; }
.svc-port { color: #666; font-family: monospace; font-size: 12px; flex: 1; }
.svc-python { color: #555; font-family: monospace; font-size: 11px; }
.svc-status-tag { font-size: 12px; padding: 2px 8px; border-radius: 4px; background: #2a2a36; color: #888; }
.svc-status-tag.running { background: #064e3b; color: #22c55e; }
.svc-status-tag.error { background: #4c0519; color: #ef4444; }
.log-box {
  background: #0a0a10; border-radius: 6px; padding: 12px;
  height: 300px; overflow-y: auto; font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px; line-height: 1.6;
}
.log-line { display: flex; gap: 10px; }
.log-time { color: #666; flex-shrink: 0; }
.log-service { color: #7c3aed; flex-shrink: 0; }
.log-empty { color: #444; text-align: center; padding: 40px 0; }
</style>
