<template>
  <div>
    <h1 class="page-title">Services</h1>

    <div class="flex-row mb-8">
      <button class="btn btn-success btn-sm" @click="startAll">Start All</button>
      <button class="btn btn-error btn-sm" @click="stopAll">Stop All</button>
      <button class="btn btn-outline btn-sm" @click="refresh">Refresh</button>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Port</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="svc in services" :key="svc.name">
            <td>{{ svc.name }}</td>
            <td>{{ svc.port || '-' }}</td>
            <td>
              <span :class="['status-dot', 'status-' + svc.status]"></span>
              {{ statusLabel(svc.status) }}
            </td>
            <td>
              <div class="actions">
                <button
                  v-if="svc.status === 'not_installed'"
                  class="btn btn-primary btn-sm"
                  @click="setup(svc.name)"
                  :disabled="actionInProgress === svc.name"
                >Install</button>
                <button
                  v-if="svc.status === 'stopped'"
                  class="btn btn-success btn-sm"
                  @click="start(svc.name)"
                  :disabled="actionInProgress === svc.name"
                >Start</button>
                <button
                  v-if="svc.status === 'running' && svc.name !== 'Live2D'"
                  class="btn btn-error btn-sm"
                  @click="stop(svc.name)"
                >Stop</button>
                <button
                  v-if="svc.status !== 'not_installed'"
                  class="btn btn-outline btn-sm"
                  @click="reinstall(svc.name)"
                >Reinstall</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-title">Logs</div>
      <LogViewer :logs="logs" />
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, inject } from 'vue'
import { apiGet, apiPost } from '../api.js'
import LogViewer from '../components/LogViewer.vue'

export default {
  name: 'ServicesView',
  components: { LogViewer },
  props: { logs: Array },
  setup() {
    const services = ref([])
    const actionInProgress = ref('')
    let healthTimer = null
    const connectSSE = inject('connectSSE')

    async function refresh() {
      try { services.value = await apiGet('/services') } catch (_) {}
    }

    async function setup(name) {
      actionInProgress.value = name
      try { await apiPost('/services/' + name + '/setup') } catch (_) {}
      actionInProgress.value = ''
      refresh()
    }

    async function start(name) {
      actionInProgress.value = name
      try { await apiPost('/services/' + name + '/start') } catch (_) {}
      actionInProgress.value = ''
      refresh()
    }

    async function stop(name) {
      try {
        await apiPost('/services/' + name + '/stop')
        refresh()
      } catch (_) {}
    }

    async function reinstall(name) {
      actionInProgress.value = name
      try {
        await apiPost('/services/' + name + '/stop')
        await apiPost('/services/' + name + '/setup')
        refresh()
      } catch (_) {}
      actionInProgress.value = ''
    }

    async function startAll() {
      try { await apiPost('/services/start-all'); refresh() } catch (_) {}
    }

    async function stopAll() {
      try { await apiPost('/services/stop-all'); refresh() } catch (_) {}
    }

    function statusLabel(s) {
      const labels = {
        not_installed: 'Not Installed',
        stopped: 'Stopped',
        starting: 'Starting...',
        running: 'Running',
        error: 'Error'
      }
      return labels[s] || s
    }

    onMounted(() => {
      connectSSE()
      refresh()
      healthTimer = setInterval(refresh, 3000)
    })

    onBeforeUnmount(() => {
      if (healthTimer) clearInterval(healthTimer)
    })

    return {
      services, actionInProgress,
      refresh, setup, start, stop, reinstall, startAll, stopAll, statusLabel
    }
  }
}
</script>
