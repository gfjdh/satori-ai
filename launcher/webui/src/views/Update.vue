<template>
  <div class="update">
    <h2>更新管理</h2>

    <div class="card" v-if="!project.initialized">
      <h3>初始化 Git 仓库</h3>
      <p>连接 Gitee 获取自动更新</p>
      <div class="form-row">
        <input v-model="giteeUrl" placeholder="Gitee 仓库地址" />
        <input v-model="githubUrl" placeholder="GitHub 仓库地址 (可选)" />
        <button class="btn-primary" @click="initProject">初始化</button>
      </div>
    </div>

    <div class="card" v-else>
      <h3>项目状态</h3>
      <div>分支: {{ project.branch }}</div>
      <div>远程: {{ project.remote || '未设置' }}</div>
    </div>

    <div class="card">
      <h3>版本更新</h3>
      <button class="btn-primary" @click="checkUpdate">检查更新</button>
      <div v-if="updateInfo">
        <p v-if="updateInfo.hasUpdate">发现 {{ updateInfo.behind }} 个新提交</p>
        <p v-else>已是最新版本</p>
        <pre v-if="updateInfo.recentLogs">{{ updateInfo.recentLogs }}</pre>
        <button v-if="updateInfo.hasUpdate" class="btn-primary" @click="applyUpdate">立即更新</button>
      </div>
    </div>

    <div class="card">
      <h3>依赖更新</h3>
      <div v-for="name in depsServices" :key="name" class="deps-row">
        <span>{{ name }}</span>
        <button class="btn-sm" @click="updateDeps(name)">更新依赖</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { apiGet, apiPost } from '../api.js'

const project = ref({})
const updateInfo = ref(null)
const giteeUrl = ref('')
const githubUrl = ref('')
const depsServices = ['TTS', 'Embedding', 'Image', 'Browser', 'ASR']

async function refresh() {
  try { project.value = await apiGet('/project/status') } catch (_) {}
}

async function initProject() {
  await apiPost('/project/init', { giteeUrl: giteeUrl.value, githubUrl: githubUrl.value })
  refresh()
}

async function checkUpdate() {
  try { updateInfo.value = await apiPost('/update/check') } catch (e) { alert(e.message) }
}

async function applyUpdate() {
  try {
    await apiPost('/update/apply')
    alert('更新完成，请重启启动器')
  } catch (e) { alert(e.message) }
}

async function updateDeps(name) {
  try {
    const r = await apiPost(`/update/deps/${name}`)
    alert(r.results.join('\n'))
  } catch (e) { alert(e.message) }
}

onMounted(refresh)
</script>

<style scoped>
.update { max-width: 700px; display: flex; flex-direction: column; gap: 16px; }
h2 { margin: 0; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; }
.card h3 { margin: 0 0 8px; }
.card p { color: #6b7280; font-size: 14px; margin: 0 0 8px; }
.form-row { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.form-row input { flex: 1; min-width: 200px; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; }
.deps-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
.deps-row span { font-size: 14px; }
.btn-sm { padding: 4px 12px; font-size: 12px; border: 1px solid #d1d5db; background: #fff; border-radius: 4px; cursor: pointer; }
pre { background: #1e1e2e; color: #cdd6f4; padding: 12px; border-radius: 6px; font-size: 12px; max-height: 150px; overflow-y: auto; }
</style>
