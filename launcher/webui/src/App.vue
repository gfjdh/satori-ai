<template>
  <div class="sidebar">
    <div class="sidebar-header">Satori AI</div>
    <nav class="sidebar-nav">
      <router-link to="/">Dashboard</router-link>
      <router-link to="/setup">Setup</router-link>
      <router-link to="/services">Services</router-link>
      <router-link to="/guide">Guide</router-link>
    </nav>
    <div class="sidebar-footer">
      <button class="btn btn-error btn-sm" @click="shutdown" style="width:100%">Exit</button>
      <div style="margin-top:4px;font-size:10px">Launcher v4.0</div>
    </div>
  </div>
  <main class="main">
    <router-view :logs="logs" @refresh-logs="connectSSE" />
  </main>
</template>

<script>
import { ref, provide, onMounted, onBeforeUnmount } from 'vue'
import { apiSSE, apiPost } from './api.js'

export default {
  name: 'App',
  setup() {
    const logs = ref([])
    let sseSource = null
    let refCount = 0

    function connectSSE() {
      refCount++
      if (sseSource) return
      sseSource = apiSSE('/logs/stream', (entry) => {
        logs.value.push(entry)
        if (logs.value.length > 10000) {
          logs.value = logs.value.slice(-10000)
        }
      })
    }

    function disconnectSSE() {
      refCount--
      if (refCount <= 0 && sseSource) {
        sseSource.close()
        sseSource = null
        refCount = 0
      }
    }

    async function shutdown() {
      try { await apiPost('/shutdown') } catch (_) {}
    }

    // pre-connect SSE for immediate log visibility
    onMounted(() => connectSSE())
    onBeforeUnmount(() => disconnectSSE())

    provide('connectSSE', connectSSE)
    provide('disconnectSSE', disconnectSSE)

    return { logs, shutdown }
  }
}
</script>
