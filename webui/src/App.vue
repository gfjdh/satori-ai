<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app-container">
    <nav class="sidebar">
      <div class="logo">
        <h2>Satori AI</h2>
        <span class="subtitle">桌宠管理后台</span>
      </div>
      <ul class="nav-menu">
        <li><RouterLink to="/">首页</RouterLink></li>
        <li><RouterLink to="/chat">对话测试</RouterLink></li>
        <li><RouterLink to="/status">状态面板</RouterLink></li>
        <li><RouterLink to="/characters">角色管理</RouterLink></li>
        <li><RouterLink to="/database">数据库</RouterLink></li>
      </ul>
    </nav>
    <main class="main-content">
      <RouterView />
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f5f5;
  color: #333;
}

.app-container {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 220px;
  background: #1a1a2e;
  color: white;
  padding: 20px;
  flex-shrink: 0;
}

.logo {
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.logo h2 {
  font-size: 24px;
  margin-bottom: 4px;
}

.logo .subtitle {
  font-size: 12px;
  color: #888;
}

.nav-menu {
  list-style: none;
}

.nav-menu li {
  margin-bottom: 8px;
}

.nav-menu a {
  display: block;
  padding: 10px 16px;
  color: #ccc;
  text-decoration: none;
  border-radius: 8px;
  transition: all 0.2s;
}

.nav-menu a:hover {
  background: rgba(255,255,255,0.1);
  color: white;
}

.nav-menu a.router-link-active {
  background: #ff6b9d;
  color: white;
}

.main-content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}
</style>
