import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
    plugins: [react()]
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers']
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'transformers': ['@xenova/transformers']
        }
      }
    }
  }
})
