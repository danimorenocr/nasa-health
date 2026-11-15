import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // En desarrollo, la API se pide al backend en :8000 (en producción lo sirve el propio backend).
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
})
