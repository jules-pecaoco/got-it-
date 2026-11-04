import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [vue()],
  build: {
    outDir: 'public/assets',
    emptyOutDir: true,
    lib: {
      entry: 'web/workspaces.ts',
      formats: ['es'],
      fileName: () => 'workspaces.js',
      cssFileName: 'workspaces',
    },
  },
});
