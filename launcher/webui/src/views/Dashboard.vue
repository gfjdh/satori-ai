<template>
  <div>
    <h1 class="page-title">Dashboard</h1>

    <div class="card" v-if="status">
      <div :class="['banner', status.jobObjectOK ? 'banner-ok' : 'banner-warn']">
        <span v-if="status.jobObjectOK">Process management OK</span>
        <span v-else>Degraded mode - orphan processes possible on exit</span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Runtimes</div>
      <div v-if="loading">Loading...</div>
      <ul class="check-list" v-else-if="env">
        <li v-for="rt in env.runtimes" :key="rt.name">
          <span :class="['check-icon', rt.ready ? 'check-ok' : 'check-fail']">
            {{ rt.ready ? '✓' : '✗' }}
          </span>
          <span>{{ rt.name }}</span>
          <span class="text-dim" v-if="rt.version">{{ rt.version }}</span>
          <span class="text-dim" v-if="!rt.ready">not ready</span>
        </li>
      </ul>
    </div>

    <div class="card">
      <div class="card-title">Services</div>
      <table v-if="services.length">
        <thead>
          <tr>
            <th>Name</th>
            <th>Port</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="svc in services" :key="svc.name">
            <td>{{ svc.name }}</td>
            <td>{{ svc.port || '-' }}</td>
            <td>
              <span :class="['status-dot', 'status-' + svc.status]"></span>
              {{ svc.status }}
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="text-dim">Loading...</div>
    </div>

    <div class="card">
      <div class="card-title flex-between">
        <span>Logs</span>
        <button class="btn btn-outline btn-sm" @click="refresh">Refresh</button>
      </div>
      <LogViewer :logs="logs" />
    </div>
  </div>
</template>

<script>
import { ref, onMounted, inject } from 'vue'
import { apiGet } from '../api.js'
import LogViewer from '../components/LogViewer.vue'

export default {
  name: 'DashboardView',
  components: { LogViewer },
  props: { logs: Array },
  setup() {
    const status = ref(null)
    const env = ref(null)
    const services = ref([])
    const loading = ref(true)
    const connectSSE = inject('connectSSE')

    async function refresh() {
      try {
        const [s, e, sv] = await Promise.all([
          apiGet('/status'),
          apiGet('/env'),
          apiGet('/services')
        ])
        status.value = s
        env.value = e
        services.value = sv || []
      } catch (err) {
        console.error(err)
      } finally {
        loading.value = false
      }
    }

    onMounted(() => {
      connectSSE()
      refresh()
    })

    return { status, env, services, loading, refresh }
  }
}
</script>
