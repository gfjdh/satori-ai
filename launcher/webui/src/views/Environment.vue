<template>
  <div class="environment">
    <h2>运行环境</h2>
    <input type="file" ref="fileInput" accept=".zip" hidden @change="onFileSelected" />
    <div class="cards">
      <div class="card">
        <h3>Node.js</h3>
        <div class="env-detail" v-if="env.node">
          <span class="dot" :class="env.node.status"></span>
          <span>{{ env.node.version || '未安装' }}</span>
          <span class="path" v-if="env.node.path">{{ env.node.path }}</span>
        </div>
        <ProgressBar v-if="installs['node']" :value="installs['node'].progress" :label="installs['node'].status" />
        <button v-else-if="runtimeStatus['node']" class="btn-done" disabled>已安装</button>
        <InstallRow v-else rt-key="node" :url="assetUrl('node')" :zipPath="zipPaths.node || ''"
          @update:zipPath="zipPaths.node = $event" @browse="browseFile('node')" @install="install('node')" />
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
        <ProgressBar v-if="installs['python-3.12']" :value="installs['python-3.12'].progress" :label="installs['python-3.12'].status" />
        <button v-else-if="runtimeStatus['python-3.12']" class="btn-done" disabled>已安装</button>
        <InstallRow v-else rt-key="python-3.12" :url="assetUrl('python-3.12')" :zipPath="zipPaths['python-3.12'] || ''"
          @update:zipPath="zipPaths['python-3.12'] = $event" @browse="browseFile('python-3.12')" @install="install('python-3.12')" />
      </div>
      <div class="card">
        <h3>Python 3.13 (内置)</h3>
        <ProgressBar v-if="installs['python-3.13']" :value="installs['python-3.13'].progress" :label="installs['python-3.13'].status" />
        <button v-else-if="runtimeStatus['python-3.13']" class="btn-done" disabled>已安装</button>
        <InstallRow v-else rt-key="python-3.13" :url="assetUrl('python-3.13')" :zipPath="zipPaths['python-3.13'] || ''"
          @update:zipPath="zipPaths['python-3.13'] = $event" @browse="browseFile('python-3.13')" @install="install('python-3.13')" />
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
import { apiGet, apiSSEPost } from '../api.js'
import ProgressBar from '../components/ProgressBar.vue'
import InstallRow from '../components/InstallRow.vue'

const env = ref({})
const runtimeStatus = reactive({})
const installs = reactive({})
const zipPaths = reactive({})
const assetUrls = ref({})
const fileInput = ref(null)
let currentBrowseKey = ''

function assetUrl(key) {
  return assetUrls.value[key] || ''
}

async function refresh() {
  try { env.value = await apiGet('/env') } catch (_) {}
  try { Object.assign(runtimeStatus, await apiGet('/runtime/status')) } catch (_) {}
}

async function loadAssetUrls() {
  try {
    const assets = await apiGet('/runtime/info')
    for (const a of assets) {
      assetUrls.value[a.key] = a.url
    }
  } catch (_) {}
}

function browseFile(key) {
  currentBrowseKey = key
  fileInput.value?.click()
}

async function onFileSelected(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const key = currentBrowseKey
  currentBrowseKey = ''

  try {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('/api/upload/temp', { method: 'POST', body: formData })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || res.statusText)
    if (data.path) {
      zipPaths[key] = data.path
    }
  } catch (e) {
    console.error('upload failed:', e)
    alert('文件上传失败: ' + (e.message || '未知错误'))
  }
  // Reset file input so the same file can be re-selected
  fileInput.value.value = ''
}

function install(key) {
  if (!zipPaths[key]) return
  installs[key] = { progress: 0, status: '准备中...' }
  apiSSEPost('/runtime/install/' + key, { path: zipPaths[key] }, (e) => {
    if (e.status === 'extracting') {
      installs[key].progress = e.progress
      installs[key].status = '解压中...'
    } else if (e.status === 'setting-up') {
      installs[key].progress = e.progress
      installs[key].status = '配置中...'
    } else if (e.status === 'done') {
      delete installs[key]
      runtimeStatus[key] = true
      refresh()
    } else if (e.status === 'error') {
      delete installs[key]
      alert('安装失败: ' + e.error)
    }
  })
}

onMounted(() => {
  refresh()
  loadAssetUrls()
})
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
