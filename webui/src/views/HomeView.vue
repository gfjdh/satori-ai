<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { healthApi, stateApi } from '@/api'

const serverStatus = ref<'checking' | 'online' | 'offline'>('checking')
const state = ref<{ affinity: any; emotion: any } | null>(null)

onMounted(async () => {
  try {
    await healthApi.check()
    serverStatus.value = 'online'
  } catch {
    serverStatus.value = 'offline'
  }

  try {
    const res = await stateApi.get()
    state.value = res.data
  } catch (e) {
    console.error('Failed to load state:', e)
  }
})
</script>

<template>
  <div class="home">
    <h1>欢迎使用 Satori AI</h1>
    <p class="subtitle">AI 桌宠管理后台</p>

    <div class="cards">
      <div class="card status-card">
        <h3>服务器状态</h3>
        <div class="status-indicator" :class="serverStatus">
          <span class="dot"></span>
          {{ serverStatus === 'checking' ? '检查中...' : serverStatus === 'online' ? '在线' : '离线' }}
        </div>
      </div>

      <div class="card">
        <h3>当前状态</h3>
        <div v-if="state" class="state-info">
          <div class="state-section">
            <h4>好感度</h4>
            <div v-for="(value, key) in state.affinity.dimensions" :key="key" class="dimension-row">
              <span class="dimension-name">{{ key }}</span>
              <div class="dimension-bar">
                <div class="dimension-fill" :style="{ width: value + '%' }"></div>
              </div>
              <span class="dimension-value">{{ value }}</span>
            </div>
          </div>
          <div class="state-section">
            <h4>情绪</h4>
            <div v-for="(value, key) in state.emotion.dimensions" :key="key" class="dimension-row">
              <span class="dimension-name">{{ key }}</span>
              <div class="dimension-bar emotion">
                <div class="dimension-fill" :style="{ width: ((value + 100) / 2) + '%' }"></div>
              </div>
              <span class="dimension-value">{{ value }}</span>
            </div>
          </div>
        </div>
        <div v-else class="loading">加载中...</div>
      </div>

      <div class="card quick-actions">
        <h3>快捷操作</h3>
        <div class="action-buttons">
          <RouterLink to="/chat" class="btn primary">对话测试</RouterLink>
          <RouterLink to="/status" class="btn">状态面板</RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home {
  max-width: 900px;
}

h1 {
  font-size: 28px;
  margin-bottom: 8px;
}

.subtitle {
  color: #666;
  margin-bottom: 30px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
}

.card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.card h3 {
  font-size: 16px;
  color: #666;
  margin-bottom: 16px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 500;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ccc;
}

.status-indicator.online .dot {
  background: #4caf50;
}

.status-indicator.offline .dot {
  background: #f44336;
}

.state-info {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.state-section h4 {
  font-size: 14px;
  color: #888;
  margin-bottom: 8px;
}

.dimension-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.dimension-name {
  width: 70px;
  font-size: 13px;
}

.dimension-bar {
  flex: 1;
  height: 8px;
  background: #eee;
  border-radius: 4px;
  overflow: hidden;
}

.dimension-fill {
  height: 100%;
  background: linear-gradient(90deg, #ff6b9d, #ff8a80);
  border-radius: 4px;
  transition: width 0.3s;
}

.dimension-bar.emotion .dimension-fill {
  background: linear-gradient(90deg, #64b5f6, #81d4fa);
}

.dimension-value {
  width: 40px;
  text-align: right;
  font-size: 13px;
  color: #666;
}

.loading {
  color: #999;
  text-align: center;
  padding: 20px;
}

.action-buttons {
  display: flex;
  gap: 12px;
}

.btn {
  display: inline-block;
  padding: 10px 20px;
  background: #f5f5f5;
  color: #333;
  text-decoration: none;
  border-radius: 8px;
  font-size: 14px;
  transition: all 0.2s;
}

.btn:hover {
  background: #eee;
}

.btn.primary {
  background: #ff6b9d;
  color: white;
}

.btn.primary:hover {
  background: #ff4081;
}
</style>
