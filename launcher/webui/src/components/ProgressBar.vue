<template>
  <div class="progress-bar">
    <div class="progress-fill" :style="{ width: pct + '%' }"></div>
    <span class="progress-text" v-if="label">{{ label }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },
  label: { type: String, default: '' },
})

const pct = computed(() => Math.min(100, Math.max(0, Math.round(props.value))))
</script>

<style scoped>
.progress-bar {
  height: 24px;
  background: #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  min-width: 100px;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #8b5cf6);
  transition: width 0.3s ease;
  border-radius: 12px;
}
.progress-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #1f2937;
}
</style>
