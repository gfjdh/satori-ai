<template>
  <div class="log-viewer" ref="el">
    <div v-for="(e, i) in entries" :key="i" class="log-line">
      <span class="log-time">{{ e.time || e.Time }}</span>
      <span class="log-service">{{ e.service || e.Service }}</span>
      <span class="log-text">{{ e.line || e.Line }}</span>
    </div>
    <div v-if="entries.length === 0" class="log-empty">暂无日志</div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  entries: { type: Array, default: () => [] },
})

const el = ref(null)

watch(() => props.entries.length, () => {
  nextTick(() => {
    if (el.value) el.value.scrollTop = el.value.scrollHeight
  })
})
</script>

<style scoped>
.log-viewer {
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 13px;
  padding: 12px;
  border-radius: 8px;
  height: 300px;
  overflow-y: auto;
  line-height: 1.6;
}
.log-line {
  display: flex;
  gap: 8px;
}
.log-time { color: #a6adc8; flex-shrink: 0; }
.log-service { color: #89b4fa; flex-shrink: 0; min-width: 70px; }
.log-text { color: #cdd6f4; word-break: break-all; }
.log-empty { color: #6c7086; text-align: center; padding: 40px; }
</style>
