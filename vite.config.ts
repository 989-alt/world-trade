import { configDefaults, defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  build: { outDir: 'dist' },
  // tests/e2e 는 Playwright 전용(vitest 가 *.spec.ts 를 줍지 않게)
  test: { exclude: [...configDefaults.exclude, 'tests/e2e/**'] },
});
