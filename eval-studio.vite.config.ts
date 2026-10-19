import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/renderer/src/eval-studio',
  base: './',
  plugins: [vue()],
  build: {
    outDir: '../../../../out/eval-studio',
    emptyOutDir: true
  }
})
