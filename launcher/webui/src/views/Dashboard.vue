<template>
  <div class="dashboard">
    <h2>仪表盘</h2>
    <div class="cards">
      <div class="card">
        <h3>运行环境</h3>
        <div class="env-status" v-if="env.node">
          <span class="dot" :class="env.node.status"></span>
          Node.js {{ env.node.version || '未检测' }}
        </div>
        <div class="env-status" v-for="py in env.python" :key="py.path">
          <span class="dot" :class="py.status"></span>
          {{ py.version || 'Python' }}
        </div>
      </div>
      <div class="card">
        <h3>服务状态</h3>
        <div v-for="s in services" :key="s.name" class="svc-row">
          <span class="dot" :class="s.status"></span>
          <span class="svc-name">{{ s.name }}</span>
          <span class="svc-port" v-if="s.port">:{{ s.port }}</span>
        </div>
      </div>
      <div class="card">
        <h3>版本</h3>
        <div class="ver-row" v-if="project.initialized">
          <span>分支:</span> {{ project.branch }}
        </div>
        <div class="ver-row" v-if="project.remote">
          <span>远程:</span> {{ project.remote }}
        </div>
        <button class="btn-sm" @click="checkUpdate">检查更新</button>
      </div>
    </div>
    <LogViewer :entries="logs" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { apiGet, apiPost } from '../api.js'
import LogViewer from '../components/LogViewer.vue'

const env = ref({})
const services = ref([])
const project = ref({})
const logs = ref([])
let es = null
let timer = 0

async function refresh() {
  try { env.value = await apiGet('/env') } catch (_) {}
  try { services.value = await apiGet('/services') } catch (_) {}
  try { project.value = await apiGet('/project/status') } catch (_) {}
}

async function checkUpdate() {
  try {
    const r = await apiPost('/update/check')
    alert(r.hasUpdate ? `有 ${r.behind} 个新提交可用` : '已是最新版本')
  } catch (e) {
    alert('检查失败: ' + e.message)
  }
}

onMounted(() => {
  refresh()
  es = new EventSource('/api/logs/stream')
  es.onmessage = (e) => {
    try { logs.value.push(JSON.parse(e.data)) } catch (_) {}
    if (logs.value.length > 200) logs.value.shift()
  }
  timer = setInterval(refresh, 5000)
})

onUnmounted(() => {
  if (es) es.close()
  clearInterval(timer)
})
</script>

<style scoped>
.dashboard { max-width: 900px; }
h2 { margin: 0 0 16px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 20px; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; }
.card h3 { margin: 0 0 12px; font-size: 14px; color: #6b7280; text-transform: uppercase; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 8px; flex-shrink: 0; }
.dot.ok, .dot.running { background: #10b981; }
.dot.missing, .dot.stopped { background: #9ca3af; }
.dot.error { background: #ef4444; }
.env-status { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; font-size: 14px; }
.svc-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 14px; }
.svc-name { flex: 1; }
.svc-port { color: #9ca3af; font-size: 12px; }
.ver-row { font-size: 13px; margin-bottom: 4px; }
.ver-row span { color: #6b7280; }
.btn-sm { padding: 4px 12px; font-size: 12px; margin-top: 8px; border: 1px solid #d1d5db; background: #fff; border-radius: 4px; cursor: pointer; }
</style>
