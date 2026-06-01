<template>
  <div class="app">
    <aside class="sidebar">
      <div class="logo">Satori AI</div>
      <nav>
        <router-link to="/" class="nav-item">
          <span class="nav-icon">◉</span> 仪表盘
        </router-link>
        <router-link to="/env" class="nav-item">
          <span class="nav-icon">⚙</span> 环境检查
        </router-link>
        <router-link to="/services" class="nav-item">
          <span class="nav-icon">▶</span> 服务管理
        </router-link>
        <router-link to="/update" class="nav-item">
          <span class="nav-icon">↻</span> 更新
        </router-link>
      </nav>
      <div class="version">v1.0.0</div>
    </aside>
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<style>
.app {
  display: flex;
  height: 100vh;
}
.sidebar {
  width: 200px;
  background: #1a1a24;
  display: flex;
  flex-direction: column;
  padding: 20px 0;
  flex-shrink: 0;
}
.logo {
  padding: 0 20px 20px;
  font-size: 18px;
  font-weight: 700;
  color: #7c3aed;
  letter-spacing: 1px;
}
nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  color: #a0a0b8;
  text-decoration: none;
  font-size: 14px;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}
.nav-item:hover {
  color: #e0e0f0;
  background: rgba(124, 58, 237, 0.1);
}
.nav-item.router-link-active {
  color: #fff;
  background: rgba(124, 58, 237, 0.2);
  border-left-color: #7c3aed;
}
.nav-icon {
  font-size: 14px;
  width: 20px;
  text-align: center;
}
.version {
  padding: 20px;
  color: #555;
  font-size: 12px;
  text-align: center;
}
.content {
  flex: 1;
  overflow-y: auto;
  padding: 30px;
}
</style>
