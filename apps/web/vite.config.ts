import tailwindcss from '@tailwindcss/vite'
import {tanstackStart} from '@tanstack/react-start/plugin/vite'
import react, {reactCompilerPreset} from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import {defineConfig} from 'vite'
import {getLocalHttpsConfig} from './vite.local-https'

export default defineConfig(({command}) => ({
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 3100,
    ...(command === 'serve' ? {https: getLocalHttpsConfig()} : {}),
  },
  plugins: [
    tanstackStart({
      spa: {
        enabled: true,
      },
    }),
    react(),
    babel({presets: [reactCompilerPreset()]}),
    tailwindcss(),
  ],
}))
