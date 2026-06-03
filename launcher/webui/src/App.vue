<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h1>Satori AI</h1>
        <span class="subtitle">启动器</span>
      </div>
      <nav>
        <router-link to="/">仪表盘</router-link>
        <router-link to="/setup">初始化</router-link>
        <router-link to="/env">环境</router-link>
        <router-link to="/services">服务</router-link>
        <router-link to="/update">更新</router-link>
        <router-link to="/guide">指南</router-link>
      </nav>
    </aside>
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'

onMounted(() => {
  window.addEventListener('beforeunload', () => {
    navigator.sendBeacon('/api/shutdown')
  })
})
</script>
