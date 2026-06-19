import {defineConfig} from 'vitest/config'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsConfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup/env.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    fileParallelism: false,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
