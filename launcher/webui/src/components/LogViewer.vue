<template>
  <div class="log-viewer" ref="container">
    <div v-if="!logs || logs.length === 0" class="text-dim">Waiting for logs...</div>
    <div
      v-for="(entry, i) in logs"
      :key="i"
      class="log-entry"
      :class="entry.level"
    >
      <span class="time">{{ entry.time }}</span>
      <span class="service" v-if="entry.service">[{{ entry.service }}]</span>
      <span class="message">{{ entry.message }}</span>
    </div>
  </div>
</template>

<script>
import { watch, ref, nextTick } from 'vue'

export default {
  name: 'LogViewer',
  props: {
    logs: { type: Array, default: () => [] }
  },
  setup(props) {
    const container = ref(null)
    watch(
      () => props.logs?.length,
      () => {
        nextTick(() => {
          if (container.value) {
            container.value.scrollTop = container.value.scrollHeight
          }
        })
      }
    )
    return { container }
  }
}
</script>
