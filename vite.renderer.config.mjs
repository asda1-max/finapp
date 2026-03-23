import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        info: resolve(__dirname, 'info.html'),
        detailed: resolve(__dirname, 'detailed.html'),
        ranking: resolve(__dirname, 'ranking.html'),
        config: resolve(__dirname, 'config.html'),
        riskmgmt: resolve(__dirname, 'riskmgmt.html'),
      },
    },
  },
  plugins: [
    tailwindcss(),
  ],
  server: {
    watch: {
      ignored: ['**/backend/**']
    }
  }
})