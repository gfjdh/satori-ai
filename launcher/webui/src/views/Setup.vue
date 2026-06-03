<template>
  <div class="setup">
    <h2>初始化向导</h2>

    <GuideBlock :num="1" title="安装运行环境" desc="下载 Node.js 和 Python 运行时" :done="step >= 1" :active="step === 0">
      <div class="runtime-list">
        <div v-for="rt in runtimes" :key="rt.key" class="runtime-item">
          <span>{{ rt.name }}</span>
          <ProgressBar v-if="rt.downloading" :value="rt.progress" :label="rt.speed" />
          <button v-else-if="rt.ready" class="btn-done" disabled>已安装</button>
          <button v-else @click="downloadRuntime(rt)" class="btn-primary">下载</button>
        </div>
      </div>
      <button class="btn-primary" style="margin-top:16px" @click="step = 1" :disabled="!allRuntimesReady">
        下一步：初始化环境
      </button>
    </GuideBlock>

    <GuideBlock :num="2" title="初始化项目环境" desc="选择要初始化的模块，创建 Python venv 并安装依赖" :done="step >= 2" :active="step === 1">
      <div class="module-list">
        <label class="module-item" v-for="mod in modules" :key="mod.name">
          <input type="checkbox" v-model="mod.checked" :disabled="initializing" />
          <span class="module-name">{{ mod.name }}</span>
          <span class="module-status" v-if="mod.done">已完成</span>
          <span class="module-status pending" v-else-if="mod.running">进行中...</span>
          <span class="module-status idle" v-else>待初始化</span>
        </label>
      </div>
      <div style="margin-top:8px">
        <label><input type="checkbox" @change="toggleAll" :checked="allChecked" :disabled="initializing" /> 全选</label>
      </div>
      <button class="btn-primary" style="margin-top:12px" @click="initSelected" :disabled="initializing || !anyChecked">
        {{ initializing ? '初始化中...' : '初始化选中模块' }}
      </button>
      <LogViewer :entries="initLogs" />
      <button class="btn-primary" style="margin-top:16px" @click="step = 2" :disabled="!allModulesDone">
        下一步：配置 API
      </button>
    </GuideBlock>

    <GuideBlock :num="3" title="配置 LLM API" desc="填写大模型连接信息（Base LLM + Vision LLM）" :done="step >= 3" :active="step === 2">
      <div class="config-form">
        <fieldset>
          <legend>Base LLM</legend>
          <label>
            API URL
            <input v-model="config.llm.url" type="text" placeholder="https://api.example.com/v1/chat/completions" />
          </label>
          <label>
            API Key
            <input v-model="config.llm.key" type="password" placeholder="sk-..." />
          </label>
          <label>
            Model
            <input v-model="config.llm.model" type="text" placeholder="model-name" />
          </label>
        </fieldset>
        <fieldset>
          <legend>Vision LLM</legend>
          <label>
            API URL
            <input v-model="config.vllm.url" type="text" placeholder="https://api.example.com/v1/chat/completions" />
          </label>
          <label>
            API Key
            <input v-model="config.vllm.key" type="password" placeholder="sk-..." />
          </label>
          <label>
            Model
            <input v-model="config.vllm.model" type="text" placeholder="vision-model-name" />
          </label>
        </fieldset>
        <button class="btn-primary" @click="saveConfig">保存配置</button>
        <p v-if="configSaved" style="color:#10b981">配置已保存</p>
      </div>
      <button class="btn-primary" style="margin-top:16px" @click="step = 3" :disabled="!configSaved">
        下一步：启动服务
      </button>
    </GuideBlock>

    <GuideBlock :num="4" title="启动全部服务" desc="按顺序启动 8 个核心服务" :done="allServicesRunning" :active="step === 3">
      <button class="btn-primary" @click="startAll" :disabled="starting">
        {{ starting ? '启动中...' : '一键启动' }}
      </button>
      <LogViewer :entries="serviceLogs" />
      <div v-if="allServicesRunning" class="done-message">所有服务已启动，可以开始使用了!</div>
    </GuideBlock>
  </div>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'
import { apiGet, apiPost, apiSSE, apiSSEPost } from '../api.js'
import GuideBlock from '../components/GuideBlock.vue'
import ProgressBar from '../components/ProgressBar.vue'
import LogViewer from '../components/LogViewer.vue'

const step = ref(0)
const runtimes = reactive([
  { key: 'node', name: 'Node.js', ready: false, downloading: false, progress: 0, speed: '' },
  { key: 'python-3.12', name: 'Python 3.12', ready: false, downloading: false, progress: 0, speed: '' },
  { key: 'python-3.13', name: 'Python 3.13', ready: false, downloading: false, progress: 0, speed: '' },
])

const allRuntimesReady = computed(() => runtimes.every(r => r.ready))

async function checkRuntimes() {
  const status = await apiGet('/runtime/status')
  for (const rt of runtimes) {
    rt.ready = status[rt.key] === true
  }
  if (allRuntimesReady.value && step.value === 0) step.value = 1
}

function downloadRuntime(rt) {
  rt.downloading = true
  rt.progress = 0
  apiSSE(`/runtime/download/${rt.key}`, (e) => {
    if (e.status === 'downloading') {
      rt.progress = e.progress
      rt.speed = e.speed || ''
    } else if (e.status === 'done') {
      rt.downloading = false
      rt.ready = true
    } else if (e.status === 'error') {
      rt.downloading = false
      alert('下载失败: ' + e.error)
    }
  })
}

// Step 2: selective module init
const modules = reactive([
  { name: 'TTS', checked: true, done: false, running: false },
  { name: 'Embedding', checked: true, done: false, running: false },
  { name: 'Image', checked: true, done: false, running: false },
  { name: 'Browser', checked: true, done: false, running: false },
  { name: 'ASR', checked: true, done: false, running: false },
])

const allChecked = computed(() => modules.every(m => m.checked))
const anyChecked = computed(() => modules.some(m => m.checked))
const allModulesDone = computed(() => modules.every(m => m.done))

function toggleAll() {
  const val = !allChecked.value
  modules.forEach(m => { if (!initializing.value) m.checked = val })
}

const initLogs = ref([])
const initializing = ref(false)

function initSelected() {
  const names = modules.filter(m => m.checked).map(m => m.name)
  if (!names.length) return
  initializing.value = true
  initLogs.value = []
  modules.forEach(m => { if (m.checked) m.running = true })

  apiSSEPost('/init', { services: names }, (e) => {
    if (e.type === 'done') {
      initializing.value = false
      modules.forEach(m => { m.running = false; m.done = true })
      return
    }
    initLogs.value.push(e)
    for (const mod of modules) {
      if (e.service === mod.name && e.line?.includes('pip install OK')) {
        mod.running = false
        mod.done = true
      }
    }
  })
}

// Step 3: LLM config (BaseLLM + VLLM)
const config = reactive({
  llm: { url: '', key: '', model: '' },
  vllm: { url: '', key: '', model: '' },
})
const configSaved = ref(false)

async function loadConfig() {
  try {
    const data = await apiGet('/config')
    if (data.llm) Object.assign(config.llm, data.llm)
    if (data.vllm) Object.assign(config.vllm, data.vllm)
  } catch (_) {}
}

async function saveConfig() {
  await apiPost('/config', { llm: config.llm, vllm: config.vllm })
  configSaved.value = true
}

// Step 4: start services
const serviceLogs = ref([])
const starting = ref(false)
const allServicesRunning = ref(false)

async function startAll() {
  starting.value = true
  const es = new EventSource('/api/logs/stream')
  es.onmessage = (e) => {
    try { serviceLogs.value.push(JSON.parse(e.data)) } catch (_) {}
  }
  await apiPost('/services/start')
  starting.value = false
  checkServices()
}

async function checkServices() {
  const services = await apiGet('/services')
  allServicesRunning.value = services.every(s => s.status === 'running')
}

checkRuntimes()
loadConfig()
checkServices()
</script>

<style scoped>
.setup { max-width: 700px; display: flex; flex-direction: column; gap: 24px; }
h2 { margin: 0 0 8px; }
.runtime-list { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
.runtime-item { display: flex; align-items: center; gap: 12px; }
.runtime-item span { min-width: 100px; }
.module-list { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.module-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; }
.module-name { font-weight: 600; flex: 1; }
.module-status { font-size: 13px; }
.module-status.idle { color: #9ca3af; }
.module-status.pending { color: #f59e0b; }
.module-status { color: #10b981; }
.config-form { display: flex; flex-direction: column; gap: 16px; margin-top: 8px; }
.config-form fieldset { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.config-form legend { font-weight: 600; font-size: 14px; color: #374151; padding: 0 6px; }
.config-form label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; color: #374151; font-weight: 500; }
.config-form input { padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
.done-message { padding: 20px; background: #ecfdf5; color: #065f46; border-radius: 8px; font-weight: 600; text-align: center; }
</style>
