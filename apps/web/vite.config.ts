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
    strictPort: true,
    allowedHosts: process.env.AMP_ORB ? true : undefined,
    ...(command === 'serve' && !process.env.AMP_ORB ? {https: getLocalHttpsConfig()} : {}),
    proxy: {
      '/zero': {
        target: `http://127.0.0.1:${process.env.ZERO_PORT ?? '4848'}`,
        ws: true,
        rewrite: path => path.replace(/^\/zero/, ''),
      },
    },
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
