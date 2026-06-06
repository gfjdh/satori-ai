<template>
  <div>
    <h1 class="page-title">Setup</h1>

    <div class="steps">
      <div :class="['step', step >= 1 && 'active', step > 1 && 'done']">1. Environment</div>
      <div :class="['step', step >= 2 && 'active', step > 2 && 'done']">2. Initialize</div>
      <div :class="['step', step >= 3 && 'active', step > 3 && 'done']">3. API Config</div>
      <div :class="['step', step >= 4 && 'active', step > 4 && 'done']">4. Start</div>
    </div>

    <!-- Step 1: Environment Check -->
    <div class="card" v-if="step === 1">
      <div class="card-title">Runtime Environment</div>
      <div v-if="loading">Checking...</div>
      <ul class="check-list" v-else-if="env">
        <li v-for="rt in env.runtimes" :key="rt.name">
          <span :class="['check-icon', rt.ready ? 'check-ok' : 'check-fail']">
            {{ rt.ready ? '✓' : '✗' }}
          </span>
          <span>{{ rt.name }}</span>
          <span class="text-dim">{{ rt.version || 'not found' }}</span>
        </li>
      </ul>
      <div class="banner banner-warn" v-if="env && !env.allReady" style="margin-top:12px">
        Some runtimes are missing. They should be included in the distribution package.
      </div>
      <button class="btn btn-primary mt-16" :disabled="!env?.allReady" @click="step = 2">
        {{ env?.allReady ? 'Next: Initialize Services' : 'Runtimes not ready' }}
      </button>
    </div>

    <!-- Step 2: Initialize Services -->
    <div class="card" v-if="step === 2">
      <div class="card-title">Initialize Services</div>
      <table v-if="services.length">
        <thead>
          <tr><th>Service</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr v-for="svc in services" :key="svc.name">
            <td>{{ svc.name }}</td>
            <td>
              <span :class="['status-dot', 'status-' + svc.status]"></span>
              {{ svc.status === 'not_installed' ? 'Not Installed' : 'Installed' }}
            </td>
          </tr>
        </tbody>
      </table>
      <button class="btn btn-primary mt-16" @click="initAll" :disabled="initializing">
        {{ initializing ? 'Installing...' : 'Install All' }}
      </button>
      <div class="text-dim mt-16">Installs dependencies for all services. This may take a while.</div>
      <button class="btn btn-outline mt-16" :disabled="!allInstalled" @click="step = 3">
        Next: Configure API
      </button>
    </div>

    <!-- Step 3: API Configuration -->
    <div class="card" v-if="step === 3">
      <div class="card-title">LLM API Configuration</div>
      <div class="form-group">
        <label>Base URL</label>
        <input v-model="config.LLM_BASE_URL" placeholder="https://api.openai.com/v1" />
      </div>
      <div class="form-group">
        <label>API Key</label>
        <input v-model="config.LLM_API_KEY" type="password" placeholder="sk-..." />
      </div>
      <div class="form-group">
        <label>Model</label>
        <input v-model="config.LLM_MODEL" placeholder="gpt-4" />
      </div>
      <h3 style="font-size:13px;color:var(--text-dim);margin:16px 0 8px">Vision LLM</h3>
      <div class="form-group">
        <label>Base URL</label>
        <input v-model="config.VISION_LLM_BASE_URL" placeholder="https://api.openai.com/v1" />
      </div>
      <div class="form-group">
        <label>API Key</label>
        <input v-model="config.VISION_LLM_API_KEY" type="password" placeholder="sk-..." />
      </div>
      <div class="form-group">
        <label>Model</label>
        <input v-model="config.VISION_LLM_MODEL" placeholder="gpt-4-vision-preview" />
      </div>
      <button class="btn btn-primary mt-16" @click="saveConfig" :disabled="saving">
        {{ saving ? 'Saving...' : 'Save Configuration' }}
      </button>
      <button class="btn btn-outline mt-16" style="margin-left:8px" @click="step = 4">
        Skip
      </button>
    </div>

    <!-- Step 4: Start All -->
    <div class="card" v-if="step === 4">
      <div class="card-title">Start All Services</div>
      <button class="btn btn-success" @click="startAll" :disabled="starting">
        {{ starting ? 'Starting...' : 'Start All Services' }}
      </button>
      <div v-if="started" class="banner banner-ok mt-16">
        All services started!
        <a :href="'http://localhost:3682'" style="color:var(--accent);margin-left:8px" target="_blank">
          Open Satori AI
        </a>
      </div>
      <div v-if="startErrors.length" class="banner banner-warn mt-16">
        <div v-for="e in startErrors" :key="e">{{ e }}</div>
      </div>
      <LogViewer :logs="logs" class="mt-16" />
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, inject } from 'vue'
import { apiGet, apiPost } from '../api.js'
import LogViewer from '../components/LogViewer.vue'

export default {
  name: 'SetupView',
  components: { LogViewer },
  props: { logs: Array },
  setup() {
    const step = ref(1)
    const env = ref(null)
    const services = ref([])
    const loading = ref(true)
    const initializing = ref(false)
    const saving = ref(false)
    const starting = ref(false)
    const started = ref(false)
    const startErrors = ref([])
    const connectSSE = inject('connectSSE')

    const config = ref({
      LLM_BASE_URL: '',
      LLM_API_KEY: '',
      LLM_MODEL: '',
      VISION_LLM_BASE_URL: '',
      VISION_LLM_API_KEY: '',
      VISION_LLM_MODEL: ''
    })

    async function loadEnv() {
      try {
        env.value = await apiGet('/env')
        loading.value = false
      } catch (_) { loading.value = false }
    }

    async function loadServices() {
      try { services.value = await apiGet('/services') } catch (_) {}
    }

    async function loadConfig() {
      try { config.value = await apiGet('/config') } catch (_) {}
    }

    async function initAll() {
      initializing.value = true
      try {
        await apiPost('/setup/init-all')
        await loadServices()
      } catch (_) {}
      initializing.value = false
    }

    async function saveConfig() {
      saving.value = true
      try {
        await apiPost('/config', config.value)
      } catch (_) {}
      saving.value = false
    }

    async function startAll() {
      starting.value = true
      try {
        const res = await apiPost('/services/start-all')
        startErrors.value = res.errors || []
        if (!startErrors.value.length) started.value = true
      } catch (_) {}
      starting.value = false
    }

    const allInstalled = computed(() =>
      services.value.length > 0 && services.value.every(s => s.status !== 'not_installed')
    )

    onMounted(() => {
      connectSSE()
      loadEnv()
      loadServices()
      loadConfig()
    })

    return {
      step, env, services, loading, config,
      initializing, saving, starting, started, startErrors,
      allInstalled, initAll, saveConfig, startAll
    }
  }
}
</script>
