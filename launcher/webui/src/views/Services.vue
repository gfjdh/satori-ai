<template>
  <div class="services">
    <h2>服务管理</h2>
    <div class="actions">
      <button class="btn-primary" @click="startAll">全部启动</button>
      <button class="btn-danger" @click="stopAll">全部停止</button>
    </div>
    <table v-if="services.length">
      <thead>
        <tr>
          <th>名称</th>
          <th>端口</th>
          <th>状态</th>
          <th>PID</th>
          <th>运行时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in services" :key="s.name">
          <td>{{ s.name }}</td>
          <td>{{ s.port || '-' }}</td>
          <td><span class="dot" :class="s.status"></span>{{ s.status }}</td>
          <td>{{ s.pid || '-' }}</td>
          <td>{{ s.uptime || '-' }}</td>
          <td>
            <button v-if="s.status === 'stopped' || s.status === 'error'" @click="start(s.name)" class="btn-sm btn-start">启动</button>
            <button v-else-if="s.status === 'running'" @click="stop(s.name)" class="btn-sm btn-stop">停止</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>加载中...</p>
    <LogViewer :entries="logs" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { apiGet, apiPost } from '../api.js'
import LogViewer from '../components/LogViewer.vue'

const services = ref([])
const logs = ref([])
let es = null
let timer = null

async function refresh() {
  try { services.value = await apiGet('/services') } catch (_) {}
}

async function startAll() { await apiPost('/services/start'); refresh() }
async function stopAll() { await apiPost('/services/stop'); refresh() }
async function start(name) { await apiPost(`/services/${name}/start`); refresh() }
async function stop(name) { await apiPost(`/services/${name}/stop`); refresh() }

onMounted(() => {
  refresh()
  es = new EventSource('/api/logs/stream')
  es.onmessage = (e) => {
    try { logs.value.push(JSON.parse(e.data)) } catch (_) {}
    if (logs.value.length > 200) logs.value.shift()
  }
  timer = setInterval(refresh, 3000)
})

onUnmounted(() => {
  if (es) es.close()
  clearInterval(timer)
})
</script>

<style scoped>
.services { max-width: 900px; }
h2 { margin: 0 0 16px; }
.actions { display: flex; gap: 8px; margin-bottom: 16px; }
table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
th, td { padding: 10px 14px; text-align: left; font-size: 14px; border-bottom: 1px solid #f3f4f6; }
th { background: #f9fafb; color: #6b7280; font-weight: 600; font-size: 12px; text-transform: uppercase; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; vertical-align: middle; }
.dot.running { background: #10b981; }
.dot.stopped { background: #9ca3af; }
.dot.error { background: #ef4444; }
.btn-sm { padding: 4px 12px; font-size: 12px; border: none; border-radius: 4px; cursor: pointer; color: #fff; }
.btn-start { background: #10b981; }
.btn-stop { background: #ef4444; }
</style>
