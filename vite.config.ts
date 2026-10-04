import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  // 用相對路徑：網站放在 GitHub Pages 的子路徑（/paperplane/）或任何資料夾都能直接開
  base: './',
  plugins: [preact()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
