import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Um banco PostgreSQL de verdade, compartilhado, com TRUNCATE entre testes.
    // Rodar em paralelo faria os arquivos truncarem a tabela um do outro no meio
    // da execucao — a falha seria intermitente e custaria dias para achar.
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/http/openapi.ts', 'src/**/*.d.ts'],
      // Piso que falha o build. Numero baixo demais nao protege nada; alto
      // demais vira teste escrito para o medidor, nao para o sistema.
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
