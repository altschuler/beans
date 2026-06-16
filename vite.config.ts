import tailwindcss from '@tailwindcss/vite'
import {tanstackStart} from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import {getLocalHttpsConfig} from './vite.local-https'

export default defineConfig(({command}) => ({
  server: {
    port: 3000,
    ...(command === 'serve' ? {https: getLocalHttpsConfig()} : {}),
  },
  plugins: [tsConfigPaths(), tanstackStart(), react(), tailwindcss()],
}))
