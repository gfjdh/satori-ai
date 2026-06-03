<template>
  <div class="environment">
    <h2>运行环境</h2>
    <div class="cards">
      <div class="card">
        <h3>Node.js</h3>
        <div class="env-detail" v-if="env.node">
          <span class="dot" :class="env.node.status"></span>
          <span>{{ env.node.version || '未安装' }}</span>
          <span class="path" v-if="env.node.path">{{ env.node.path }}</span>
        </div>
        <ProgressBar v-if="downloads['node']" :value="downloads['node'].progress" :label="downloads['node'].speed" />
        <button v-else-if="env.node?.status === 'ok'" class="btn-done" disabled>已安装</button>
        <button v-else @click="download('node')" class="btn-primary">一键下载</button>
      </div>
      <div class="card" v-for="py in env.python" :key="py.path">
        <h3>{{ py.version || 'Python' }}</h3>
        <div class="env-detail">
          <span class="dot" :class="py.status"></span>
          <span class="path" v-if="py.path">{{ py.path }}</span>
        </div>
        <span v-if="py.hint" class="hint">{{ py.hint }}</span>
      </div>
      <div class="card">
        <h3>Python 3.12 (内置)</h3>
        <ProgressBar v-if="downloads['python-3.12']" :value="downloads['python-3.12'].progress" :label="downloads['python-3.12'].speed" />
        <button v-else-if="runtimeStatus['python-3.12']" class="btn-done" disabled>已安装</button>
        <button v-else @click="download('python-3.12')" class="btn-primary">一键下载</button>
      </div>
      <div class="card">
        <h3>Python 3.13 (内置)</h3>
        <ProgressBar v-if="downloads['python-3.13']" :value="downloads['python-3.13'].progress" :label="downloads['python-3.13'].speed" />
        <button v-else-if="runtimeStatus['python-3.13']" class="btn-done" disabled>已安装</button>
        <button v-else @click="download('python-3.13')" class="btn-primary">一键下载</button>
      </div>
      <div class="card">
        <h3>Git</h3>
        <div class="env-detail" v-if="env.git">
          <span class="dot" :class="env.git.status"></span>
          <span>{{ env.git.version || '未安装' }}</span>
        </div>
        <span v-if="env.git?.hint" class="hint">{{ env.git.hint }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { apiGet, apiSSE } from '../api.js'
import ProgressBar from '../components/ProgressBar.vue'

const env = ref({})
const runtimeStatus = reactive({})
const downloads = reactive({})

async function refresh() {
  try { env.value = await apiGet('/env') } catch (_) {}
  try { Object.assign(runtimeStatus, await apiGet('/runtime/status')) } catch (_) {}
}

function download(key) {
  downloads[key] = { progress: 0, speed: '' }
  apiSSE(`/runtime/download/${key}`, (e) => {
    if (e.status === 'downloading') {
      downloads[key].progress = e.progress
      downloads[key].speed = e.speed || ''
    } else if (e.status === 'done') {
      delete downloads[key]
      runtimeStatus[key] = true
      refresh()
    } else if (e.status === 'error') {
      delete downloads[key]
      alert('下载失败: ' + e.error)
    }
  })
}

onMounted(refresh)
</script>

<style scoped>
.environment { max-width: 900px; }
h2 { margin: 0 0 16px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; }
.card h3 { margin: 0 0 12px; font-size: 14px; color: #6b7280; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 8px; }
.dot.ok { background: #10b981; }
.dot.missing { background: #9ca3af; }
.dot.error { background: #ef4444; }
.env-detail { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; font-size: 14px; }
.path { color: #9ca3af; font-size: 12px; word-break: break-all; }
.hint { color: #6b7280; font-size: 12px; }
</style>
