<template>
  <div class="install-row">
    <a class="btn-link" :href="url" target="_blank" :title="url">下载压缩包</a>
    <div class="path-row">
      <input type="text" :value="zipPath" @input="$emit('update:zipPath', $event.target.value)"
        placeholder="选择或粘贴zip文件路径..." />
      <button class="btn-sm btn-browse" @click="$emit('browse')" title="浏览文件">...</button>
    </div>
    <button class="btn-primary btn-install" :disabled="!zipPath" @click="$emit('install')">安装</button>
  </div>
</template>

<script setup>
defineProps({
  url: { type: String, default: '' },
  zipPath: { type: String, default: '' },
})
defineEmits(['update:zipPath', 'browse', 'install'])
</script>

<style scoped>
.install-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.btn-link {
  display: inline-block;
  padding: 6px 14px;
  background: #eff6ff;
  color: #2563eb;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  text-decoration: none;
  font-size: 13px;
  text-align: center;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btn-link:hover { background: #dbeafe; }
.path-row {
  display: flex;
  gap: 4px;
}
.path-row input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 12px;
  min-width: 0;
}
.path-row input:focus {
  outline: none;
  border-color: #6366f1;
}
.btn-sm {
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.btn-sm:hover { background: #f3f4f6; }
.btn-install {
  width: 100%;
}
.btn-install:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
