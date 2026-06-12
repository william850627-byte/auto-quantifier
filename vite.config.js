import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'esnext',
    assetsInlineLimit: 100000000, // 強制所有資源轉為 Base64 內聯
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,          // 將 CSS 揉入 HTML <style>
    brotliSize: false,
    rollupOptions: {
      inlineDynamicImports: true,
      output: {
        manualChunks: undefined,
      },
    },
  },
});