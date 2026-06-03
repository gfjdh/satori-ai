<template>
  <div class="guide-block">
    <div class="guide-number" :class="{ done: done }">
      {{ done ? '✓' : num }}
    </div>
    <div class="guide-body">
      <h3>{{ title }}</h3>
      <p>{{ desc }}</p>
      <slot></slot>
    </div>
    <div class="guide-status" v-if="done">完成</div>
    <div class="guide-status pending" v-else-if="active">进行中...</div>
  </div>
</template>

<script setup>
defineProps({
  num: Number,
  title: String,
  desc: String,
  done: Boolean,
  active: Boolean,
})
</script>

<style scoped>
.guide-block {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 20px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}
.guide-number {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: #e5e7eb;
  color: #6b7280;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 16px;
  flex-shrink: 0;
}
.guide-number.done { background: #10b981; color: #fff; }
.guide-body { flex: 1; }
.guide-body h3 { margin: 0 0 4px; font-size: 16px; }
.guide-body p { margin: 0 0 12px; color: #6b7280; font-size: 14px; }
.guide-status { color: #10b981; font-weight: 600; font-size: 14px; }
.guide-status.pending { color: #f59e0b; }
</style>
