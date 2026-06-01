<template>
  <div>
    <h2>环境检查</h2>

    <!-- Node.js -->
    <div class="card">
      <div class="tool-header">
        <span class="tool-icon">🟢</span>
        <div>
          <h3>Node.js</h3>
          <p class="tool-desc">JavaScript 运行时，运行后端和前端服务</p>
        </div>
      </div>
      <div class="tool-body">
        <div v-if="env.node?.status === 'ok'" class="status-ok">
          ✅ 已安装 — {{ env.node.version }}
          <div class="path-info">{{ env.node.path }}</div>
        </div>
        <div v-else-if="env.node?.status === 'missing'" class="status-missing">
          ⚠️ 未检测到 Node.js
          <div v-if="guide.node" class="guide-box">
            <p>{{ guide.node.note }}</p>
            <a :href="guide.node.url" target="_blank" class="btn btn-primary">
              前往下载 {{ guide.node.displayName }}
            </a>
          </div>
        </div>
        <div v-else class="status-error">❌ 检测异常</div>
      </div>
    </div>

    <!-- Python (all detected versions) -->
    <div class="card">
      <div class="tool-header">
        <span class="tool-icon">🐍</span>
        <div>
          <h3>Python</h3>
          <p class="tool-desc">运行 TTS/图像/浏览器/ASR 等 AI 微服务</p>
          <p class="tool-note">⚠️ ASR 服务需要 Python 3.12（numpy 在 Windows 上对 3.13 缺少 MSVC wheel）</p>
        </div>
      </div>
      <div class="tool-body">
        <div v-if="env.python?.length > 0">
          <div v-for="(py, i) in env.python" :key="'py'+i" class="py-item">
            <span :class="py.status === 'ok' ? 'status-ok' : 'status-error'">
              {{ py.status === 'ok' ? '✅' : '❌' }}
            </span>
            <span class="py-version">{{ py.version || 'Unknown' }}</span>
            <span class="py-path">{{ py.path }}</span>
          </div>
        </div>
        <div v-else class="status-missing">
          ⚠️ 未检测到 Python
        </div>

        <!-- Missing versions guide -->
        <div v-if="!hasPython312" class="guide-box">
          <p>⚠️ 缺少 Python 3.12（ASR 服务必需）。{{ guide.python?.note }}</p>
          <a :href="guide.python?.url" target="_blank" class="btn btn-primary">下载 Python 3.12</a>
        </div>
        <div v-if="!hasPython313" class="guide-box">
          <p>建议安装 Python 3.13。{{ guide.python313?.note }}</p>
          <a :href="guide.python313?.url" target="_blank" class="btn">下载 Python 3.13</a>
        </div>
      </div>
    </div>

    <!-- Git -->
    <div class="card">
      <div class="tool-header">
        <span class="tool-icon">📦</span>
        <div>
          <h3>Git</h3>
          <p class="tool-desc">版本管理，用于更新项目到最新版</p>
        </div>
      </div>
      <div class="tool-body">
        <div v-if="env.git?.status === 'ok'" class="status-ok">
          ✅ 已安装 — {{ env.git.version }}
          <div class="path-info">{{ env.git.path }}</div>
        </div>
        <div v-else-if="env.git?.status === 'missing'" class="status-missing">
          ⚠️ 未检测到 Git
          <div v-if="guide.git" class="guide-box">
            <p>{{ guide.git.note }}</p>
            <a :href="guide.git.url" target="_blank" class="btn btn-primary">
              前往下载 {{ guide.git.displayName }}
            </a>
          </div>
        </div>
        <div v-else class="status-error">❌ 检测异常</div>
      </div>
    </div>

    <button class="btn" @click="refreshAll">重新检测全部</button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

const env = ref({ node: {}, python: [], git: {} })
const guide = ref({})

const hasPython312 = computed(() =>
  env.value.python?.some(p => p.status === 'ok' && p.version?.includes('3.12'))
)
const hasPython313 = computed(() =>
  env.value.python?.some(p => p.status === 'ok' && (p.version?.includes('3.13') || p.version?.includes('3.14')))
)

async function refreshAll() {
  const res = await fetch('/api/env')
  env.value = await res.json()

  // fetch install guides
  for (const tool of ['node', 'python', 'python313', 'git']) {
    const g = await fetch(`/api/env/install-guide/${tool}`)
    guide.value[tool] = await g.json()
  }
}

onMounted(refreshAll)
</script>

<style scoped>
h2 { font-size: 24px; margin-bottom: 20px; color: #fff; }
h3 { font-size: 16px; color: #e0e0e0; margin: 0; }
.card { background: #1a1a24; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
.tool-header { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 14px; }
.tool-icon { font-size: 28px; flex-shrink: 0; }
.tool-desc { font-size: 13px; color: #666; margin-top: 2px; }
.tool-note { font-size: 12px; color: #f59e0b; margin-top: 4px; }
.tool-body { margin-left: 42px; }
.py-item { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 14px; }
.py-version { color: #7c3aed; font-family: monospace; }
.py-path { color: #555; font-family: monospace; font-size: 11px; max-width: 450px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-ok { color: #22c55e; font-size: 14px; }
.status-missing { color: #f59e0b; font-size: 14px; }
.status-error { color: #ef4444; font-size: 14px; }
.path-info { color: #555; font-family: monospace; font-size: 12px; margin-top: 4px; }
.guide-box { background: #0f0f18; border-radius: 6px; padding: 14px; margin-top: 10px; }
.guide-box p { font-size: 13px; color: #a0a0b8; line-height: 1.6; margin-bottom: 8px; }
.btn { padding: 8px 16px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; color: #e0e0e0; background: #2a2a36; display: inline-block; margin-top: 8px; text-decoration: none; }
.btn:hover { background: #3a3a48; }
.btn-primary { background: #7c3aed; }
.btn-primary:hover { background: #6d28d9; }
</style>
