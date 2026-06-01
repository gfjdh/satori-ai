<template>
  <div>
    <h2>服务管理</h2>

    <div class="btn-group top-actions">
      <button class="btn btn-primary" @click="startAll" :disabled="loading">
        {{ loading ? '启动中...' : '全部启动（串行）' }}
      </button>
      <button class="btn btn-danger" @click="stopAll" :disabled="loading">全部停止</button>
      <button class="btn" @click="initEnv" :disabled="initRunning">
        {{ initRunning ? '初始化中...' : '初始化环境' }}
      </button>
    </div>
    <p class="order-hint">启动顺序：微服务(TTS→Embedding→Image→Browser→ASR) → WebUI → Backend → Live2D，每个间隔 3 秒</p>

    <div class="svc-list">
      <div v-for="s in services" :key="s.name" class="svc-card" :class="s.status">
        <div class="svc-top">
          <span class="svc-dot" :class="s.status"></span>
          <span class="svc-name">{{ s.name }}</span>
          <span class="svc-order">#{{ s.startOrder }}</span>
          <span class="svc-port" v-if="s.port">端口 :{{ s.port }}</span>
          <span class="svc-python" v-if="s.pythonVer">{{ s.pythonVer }}</span>
          <span class="svc-status-tag" :class="s.status">{{ statusText(s.status) }}</span>
          <span class="svc-pid" v-if="s.pid">PID {{ s.pid }}</span>
        </div>
        <div class="svc-meta">
          <span class="svc-cmd">{{ s.cmd }}</span>
          <span class="svc-workdir">📂 {{ s.workDir }}</span>
        </div>
        <div class="svc-actions">
          <button
            class="btn btn-sm btn-start"
            @click="startOne(s.name)"
            :disabled="loading || s.status === 'running'"
          >启动</button>
          <button
            class="btn btn-sm btn-stop"
            @click="stopOne(s.name)"
            :disabled="loading || s.status !== 'running'"
          >停止</button>
          <button
            v-if="hasDeps(s.name)"
            class="btn btn-sm btn-deps"
            @click="updateDeps(s.name)"
            :disabled="depsLoading[s.name]"
          >
            {{ depsLoading[s.name] ? '更新中...' : '更新依赖' }}
          </button>
        </div>
        <div v-if="depResults[s.name]" class="dep-result" :class="{ fail: depResults[s.name].includes('FAILED') }">
          {{ depResults[s.name] }}
        </div>
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
        <div v-if="logs.length === 0" class="log-empty">暂无日志 — 点击"全部启动"开始</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue'

const services = ref([])
const logs = ref([])
const loading = ref(false)
const initRunning = ref(false)
const depsLoading = reactive({})
const depResults = reactive({})
const logBox = ref(null)

let eventSource = null

// Services with dependency management
const depsMap = {
  Backend: 'npm', WebUI: 'npm',
  TTS: 'pip', Embedding: 'pip', Image: 'pip', Browser: 'pip', ASR: 'pip',
}

function hasDeps(name) { return !!depsMap[name] }

function statusText(s) {
  return s === 'running' ? '运行中' : s === 'error' ? '异常' : '已停止'
}

async function refreshServices() {
  const res = await fetch('/api/services')
  services.value = await res.json()
}

async function startOne(name) {
  loading.value = true
  await fetch(`/api/services/${name}/start`, { method: 'POST' })
  loading.value = false
  setTimeout(refreshServices, 1500)
}

async function stopOne(name) {
  loading.value = true
  await fetch(`/api/services/${name}/stop`, { method: 'POST' })
  loading.value = false
  setTimeout(refreshServices, 1500)
}

async function updateDeps(name) {
  depsLoading[name] = true
  delete depResults[name]
  const res = await fetch(`/api/services/${name}/update-deps`, { method: 'POST' })
  const data = await res.json()
  depResults[name] = (data.results || []).join('; ') + (data.error ? ' (error)' : '')
  depsLoading[name] = false
  setTimeout(() => { delete depResults[name] }, 10000)
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

async function initEnv() {
  initRunning.value = true
  const evtSource = new EventSource('/api/init-env')
  evtSource.onmessage = (e) => {
    const entry = JSON.parse(e.data)
    logs.value.push(entry)
    if (logs.value.length > 500) logs.value.shift()
    nextTick(() => {
      if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
    })
  }
  evtSource.onerror = () => {
    evtSource.close()
    initRunning.value = false
  }
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

let timer = null
onMounted(() => {
  refreshServices()
  connectLogs()
  timer = setInterval(refreshServices, 5000)
})

onUnmounted(() => {
  if (eventSource) eventSource.close()
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
h2 { font-size: 24px; margin-bottom: 20px; color: #fff; }
h3 { font-size: 14px; color: #888; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 1px; }
.card { background: #1a1a24; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
.top-actions { margin-bottom: 8px; }
.order-hint { font-size: 12px; color: #555; margin-bottom: 16px; }
.btn-group { display: flex; gap: 8px; }
.btn {
  padding: 8px 16px; border: none; border-radius: 6px; font-size: 13px;
  cursor: pointer; color: #e0e0e0; background: #2a2a36;
}
.btn:hover { background: #3a3a48; }
.btn-sm { padding: 6px 12px; font-size: 12px; }
.btn-primary { background: #7c3aed; }
.btn-primary:hover { background: #6d28d9; }
.btn-danger { background: #991b1b; }
.btn-danger:hover { background: #7f1d1d; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.svc-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
.svc-card {
  background: #1a1a24; border-radius: 8px; padding: 16px;
  border-left: 3px solid #333;
}
.svc-card.running { border-left-color: #22c55e; }
.svc-card.error { border-left-color: #ef4444; }
.svc-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.svc-dot { width: 8px; height: 8px; border-radius: 50%; background: #555; }
.svc-dot.running { background: #22c55e; }
.svc-dot.error { background: #ef4444; }
.svc-name { font-weight: 600; font-size: 14px; }
.svc-order { color: #555; font-family: monospace; font-size: 11px; }
.svc-port { color: #666; font-family: monospace; font-size: 12px; flex: 1; }
.svc-python { color: #a78bfa; font-size: 11px; }
.svc-status-tag { font-size: 12px; padding: 2px 8px; border-radius: 4px; background: #2a2a36; color: #888; }
.svc-status-tag.running { background: #064e3b; color: #22c55e; }
.svc-status-tag.error { background: #4c0519; color: #ef4444; }
.svc-pid { color: #555; font-family: monospace; font-size: 12px; }
.svc-meta { margin-bottom: 10px; }
.svc-cmd { font-family: monospace; font-size: 12px; color: #888; display: block; margin-bottom: 2px; }
.svc-workdir { font-size: 12px; color: #555; display: block; }
.svc-actions { display: flex; gap: 6px; }
.btn-start { background: #064e3b; color: #22c55e; }
.btn-start:hover:not(:disabled) { background: #065f46; }
.btn-stop { background: #4c0519; color: #fca5a5; }
.btn-stop:hover:not(:disabled) { background: #7f1d1d; }
.btn-deps { background: #1e1b4b; color: #a78bfa; }
.btn-deps:hover:not(:disabled) { background: #312e81; }
.dep-result { margin-top: 8px; font-family: monospace; font-size: 12px; padding: 6px 10px; border-radius: 4px; background: #0a0a10; color: #22c55e; }
.dep-result.fail { color: #ef4444; }
.log-box {
  background: #0a0a10; border-radius: 6px; padding: 12px;
  height: 250px; overflow-y: auto; font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px; line-height: 1.6;
}
.log-line { display: flex; gap: 10px; }
.log-time { color: #666; flex-shrink: 0; }
.log-service { color: #7c3aed; flex-shrink: 0; }
.log-empty { color: #444; text-align: center; padding: 40px 0; }
</style>
