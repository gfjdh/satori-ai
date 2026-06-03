import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'esnext',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:9527',
    },
  },
})
