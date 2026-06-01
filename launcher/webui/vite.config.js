import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:9527'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
