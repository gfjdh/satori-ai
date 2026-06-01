<template>
  <div>
    <h2>更新</h2>

    <div class="card">
      <h3>版本检查</h3>
      <div class="update-status" v-if="updateStatus">
        <div class="version-row">
          <span class="v-label">当前版本</span>
          <code class="v-value">{{ updateStatus.current }}</code>
        </div>
        <div class="version-row">
          <span class="v-label">最新版本</span>
          <code class="v-value">{{ updateStatus.latest }}</code>
        </div>
        <div class="version-row">
          <span class="v-label">检查时间</span>
          <span class="v-time">{{ updateStatus.lastCheck }}</span>
        </div>

        <div v-if="updateStatus.hasUpdate" class="update-available">
          ✅ 发现新版本！共 {{ updateStatus.commits?.length || 0 }} 个新提交：
          <ul class="commit-list">
            <li v-for="c in updateStatus.commits" :key="c">{{ c }}</li>
          </ul>
          <div class="btn-group">
            <button class="btn btn-primary" @click="applyUpdate" :disabled="updating">
              {{ updating ? '更新中...' : '立即更新' }}
            </button>
          </div>
        </div>
        <div v-else class="update-none">
          ✅ 已是最新版本
        </div>
      </div>
      <div v-else class="update-placeholder">
        点击下方按钮检查更新
      </div>
      <button class="btn" @click="checkUpdate" :disabled="checking" style="margin-top: 12px">
        {{ checking ? '检查中...' : '检查更新' }}
      </button>
    </div>

    <div class="card">
      <h3>依赖更新</h3>
      <p class="desc">重新安装所有 npm 和 pip 依赖包。当服务启动异常时可尝试此操作。</p>
      <button class="btn btn-primary" @click="updateDeps" :disabled="depUpdating">
        {{ depUpdating ? '更新中...' : '更新所有依赖' }}
      </button>
      <div v-if="depResults.length > 0" class="dep-results">
        <div v-for="(r, i) in depResults" :key="i" class="dep-line" :class="r.includes('FAILED') ? 'fail' : 'ok'">
          {{ r }}
        </div>
      </div>
    </div>

    <div class="card">
      <h3>更新说明</h3>
      <ul class="help-list">
        <li>更新前请先停止所有服务</li>
        <li>更新源代码后可能需要更新依赖</li>
        <li>如果更新后出现问题，可以重新运行"初始化环境"</li>
        <li>手动更新：在项目目录打开命令行运行 <code>git pull</code></li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const updateStatus = ref(null)
const checking = ref(false)
const updating = ref(false)
const depUpdating = ref(false)
const depResults = ref([])

async function checkUpdate() {
  checking.value = true
  updateStatus.value = null
  const res = await fetch('/api/update/check', { method: 'POST' })
  updateStatus.value = await res.json()
  checking.value = false
}

async function applyUpdate() {
  updating.value = true
  const res = await fetch('/api/update/apply', { method: 'POST' })
  const result = await res.json()
  if (result.error) {
    alert('更新失败：' + result.error)
  } else {
    alert('更新成功！请重启服务。')
    await checkUpdate()
  }
  updating.value = false
}

async function updateDeps() {
  depUpdating.value = true
  depResults.value = []
  const res = await fetch('/api/update/deps', { method: 'POST' })
  const data = await res.json()
  depResults.value = data.results || []
  depUpdating.value = false
}
</script>

<style scoped>
h2 { font-size: 24px; margin-bottom: 20px; color: #fff; }
h3 { font-size: 14px; color: #888; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 1px; }
.card {
  background: #1a1a24; border-radius: 8px; padding: 20px; margin-bottom: 16px;
}
.desc { font-size: 13px; color: #a0a0b8; margin-bottom: 12px; }
.update-status { margin-top: 8px; }
.version-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; font-size: 14px; }
.v-label { color: #888; min-width: 70px; }
.v-value { background: #0a0a10; padding: 2px 8px; border-radius: 4px; font-size: 13px; color: #7c3aed; }
.v-time { color: #666; font-size: 13px; }
.update-available { margin-top: 12px; padding: 14px; background: #064e3b; border-radius: 6px; color: #22c55e; font-size: 14px; }
.update-none { margin-top: 12px; padding: 14px; background: #1a1a24; border-radius: 6px; color: #22c55e; font-size: 14px; }
.update-placeholder { color: #555; font-size: 14px; margin-top: 8px; }
.commit-list { margin: 8px 0 0 20px; font-family: monospace; font-size: 12px; color: #a0d8b0; }
.btn-group { display: flex; gap: 8px; margin-top: 12px; }
.btn {
  padding: 8px 16px; border: none; border-radius: 6px; font-size: 13px;
  cursor: pointer; color: #e0e0e0; background: #2a2a36;
}
.btn:hover { background: #3a3a48; }
.btn-primary { background: #7c3aed; }
.btn-primary:hover { background: #6d28d9; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.dep-results { margin-top: 12px; }
.dep-line { font-family: monospace; font-size: 12px; padding: 4px 0; }
.dep-line.ok { color: #22c55e; }
.dep-line.fail { color: #ef4444; }
.help-list { font-size: 13px; color: #888; padding-left: 18px; line-height: 2; }
.help-list code { background: #0a0a10; padding: 2px 6px; border-radius: 3px; font-size: 12px; color: #7c3aed; }
</style>
