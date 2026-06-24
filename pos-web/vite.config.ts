import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

function gitHash() {
  // Railway injects RAILWAY_GIT_COMMIT_SHA as a build arg; fall back to local git
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.BUILD_VERSION;
  if (sha) return sha.slice(0, 8);
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'unknown'; }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_HASH__: JSON.stringify(gitHash()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
  },
});
