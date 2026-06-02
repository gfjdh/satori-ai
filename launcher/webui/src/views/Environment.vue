<template>
  <div>
    <h2>环境检查</h2>
    <p class="page-desc">以下三个工具是运行 Satori AI 的必要环境。缺失时请按指引安装。</p>

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
        <template v-if="env.node?.status === 'ok'">
          <div class="status-ok">✅ 已安装 — {{ env.node.version }}</div>
          <div class="path-info">{{ env.node.path }}</div>
        </template>
        <template v-else-if="env.node?.status === 'missing'">
          <GuideBlock :guide="guides.node" />
        </template>
        <div v-else class="status-error">❌ 检测异常 — {{ env.node?.path }}</div>
      </div>
    </div>

    <!-- Python -->
    <div class="card">
      <div class="tool-header">
        <span class="tool-icon">🐍</span>
        <div>
          <h3>Python</h3>
          <p class="tool-desc">运行 TTS / Embedding / Image / Browser / ASR 等 AI 微服务</p>
        </div>
      </div>
      <div class="tool-body">
        <!-- Detected versions -->
        <div v-if="hasAnyPython" class="detected-section">
          <div class="section-label">已检测到的版本</div>
          <div v-for="(py, i) in env.python.filter(p => p.status === 'ok')" :key="'py'+i" class="py-item">
            <span class="status-ok">✅</span>
            <span class="py-version">{{ py.version }}</span>
            <span class="py-path">{{ py.path }}</span>
          </div>
        </div>
        <div v-else class="status-missing">
          ⚠️ 未检测到任何 Python 版本
        </div>

        <!-- Missing: Python 3.12 -->
        <template v-if="!hasPython312">
          <div class="requirement-tag">⚠️ ASR 服务必须</div>
          <GuideBlock :guide="guides.python" />
        </template>

        <!-- Missing: Python 3.13 -->
        <template v-if="!hasPython313">
          <div class="requirement-tag">建议安装</div>
          <GuideBlock :guide="guides.python313" />
        </template>
      </div>
    </div>

    <!-- Git -->
    <div class="card">
      <div class="tool-header">
        <span class="tool-icon">📦</span>
        <div>
          <h3>Git</h3>
          <p class="tool-desc">版本管理，用于检查和应用项目更新</p>
        </div>
      </div>
      <div class="tool-body">
        <template v-if="env.git?.status === 'ok'">
          <div class="status-ok">✅ 已安装 — {{ env.git.version }}</div>
          <div class="path-info">{{ env.git.path }}</div>
        </template>
        <template v-else-if="env.git?.status === 'missing'">
          <GuideBlock :guide="guides.git" />
        </template>
        <div v-else class="status-error">❌ 检测异常 — {{ env.git?.path }}</div>
      </div>
    </div>

    <button class="btn" @click="refreshAll">重新检测全部</button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

const env = ref({ node: {}, python: [], git: {} })
const guides = ref({})

const hasAnyPython = computed(() =>
  env.value.python?.some(p => p.status === 'ok')
)
const hasPython312 = computed(() =>
  env.value.python?.some(p => p.status === 'ok' && p.version?.includes('3.12'))
)
const hasPython313 = computed(() =>
  env.value.python?.some(p => p.status === 'ok' && (p.version?.includes('3.13') || p.version?.includes('3.14')))
)

async function refreshAll() {
  const res = await fetch('/api/env')
  env.value = await res.json()

  for (const tool of ['node', 'python', 'python313', 'git']) {
    try {
      const g = await fetch(`/api/env/install-guide/${tool}`)
      guides.value[tool] = await g.json()
    } catch {
      // Keep built-in fallback so buttons still render
    }
  }
}

onMounted(refreshAll)
</script>

<script>
// GuideBlock component — renders download button + step-by-step instructions
export default {
  components: {
    GuideBlock: {
      props: { guide: Object },
      template: `
        <div class="guide-box">
          <p class="guide-note">{{ guide?.note || '请按以下步骤安装：' }}</p>
          <ol class="guide-steps" v-if="guide?.steps?.length">
            <li v-for="s in guide.steps" :key="s">{{ s }}</li>
          </ol>
          <a v-if="guide?.url" :href="guide.url" target="_blank" class="btn btn-primary">
            前往下载 {{ guide?.displayName || '' }}
          </a>
        </div>
      `
    }
  }
}
</script>

<style scoped>
h2 { font-size: 24px; margin-bottom: 8px; color: #fff; }
h3 { font-size: 16px; color: #e0e0e0; margin: 0; }
.page-desc { font-size: 13px; color: #666; margin-bottom: 20px; }
.card { background: #1a1a24; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
.tool-header { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 14px; }
.tool-icon { font-size: 28px; flex-shrink: 0; line-height: 1; }
.tool-desc { font-size: 13px; color: #666; margin-top: 2px; }
.tool-body { margin-left: 42px; }

.status-ok { color: #22c55e; font-size: 14px; font-weight: 500; }
.status-missing { color: #f59e0b; font-size: 14px; margin-bottom: 10px; }
.status-error { color: #ef4444; font-size: 14px; }
.path-info { color: #555; font-family: monospace; font-size: 12px; margin-top: 4px; word-break: break-all; }

.detected-section { margin-bottom: 12px; }
.section-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
.py-item { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; font-size: 14px; }
.py-version { color: #7c3aed; font-family: monospace; font-weight: 500; }
.py-path { color: #555; font-family: monospace; font-size: 11px; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.requirement-tag {
  display: inline-block;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  background: #331707;
  color: #f59e0b;
  margin-top: 10px;
  margin-bottom: 4px;
  font-weight: 500;
}

.guide-box {
  background: #0f0f18;
  border: 1px solid #2a2a36;
  border-radius: 8px;
  padding: 18px;
  margin-top: 8px;
}
.guide-note {
  font-size: 13px;
  color: #e0e0e0;
  line-height: 1.6;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid #1e1e2a;
}
.guide-steps {
  padding-left: 20px;
  margin-bottom: 14px;
}
.guide-steps li {
  font-size: 13px;
  color: #a0a0b8;
  line-height: 2;
  padding-left: 4px;
}
.guide-steps li::marker {
  color: #7c3aed;
  font-weight: 600;
  font-size: 12px;
}

.btn {
  padding: 10px 20px; border: none; border-radius: 6px; font-size: 14px;
  cursor: pointer; color: #fff; background: #2a2a36;
  display: inline-block; text-decoration: none; font-weight: 500;
  transition: background 0.2s;
}
.btn:hover { background: #3a3a48; }
.btn-primary { background: #7c3aed; }
.btn-primary:hover { background: #6d28d9; }
</style>
