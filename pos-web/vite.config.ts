import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

function gitHash() {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.BUILD_VERSION;
  if (sha) return sha.slice(0, 8);
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'unknown'; }
}

function gitMessage() {
  // Railway exposes the commit message as a build/deploy variable; prefer it
  // because the Docker build context has no .git directory.
  const fromEnv = process.env.RAILWAY_GIT_COMMIT_MESSAGE;
  if (fromEnv) return fromEnv.trim();
  try { return execSync('git log -1 --pretty=%s').toString().trim(); }
  catch { return ''; }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_HASH__: JSON.stringify(gitHash()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_MESSAGE__: JSON.stringify(gitMessage()),
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
  test: {
    environment: 'node',
    // Run tests in a zone that is NOT Singapore. Anything that formats a time
    // without pinning timeZone renders in the machine's zone, which silently
    // looks correct on an SGT till or dev box and wrong everywhere else — the
    // receipt printer shipped that way. UTC makes the mistake fail here first.
    env: { TZ: 'UTC' },
  },
});
