import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
// @ts-ignore -- module Node présent à la construction (les types de Node ne sont pas installés dans le projet web)
import { execSync } from 'node:child_process';
// @ts-ignore -- idem
import { readFileSync, writeFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

declare const process: { env: Record<string, string | undefined> };

// Version affichée dans Paramètres : commit Git (Vercel le fournit, sinon lu localement) et date de construction.
function commit(): string {
  const fromHost = process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT;
  if (fromHost) return fromHost.slice(0, 7);
  try {
    return String(execSync('git rev-parse --short HEAD')).trim();
  } catch {
    return 'local';
  }
}

/**
 * Cache du téléphone : version du service worker changée à chaque construction (commit + heure). À la mise en ligne,
 * le nouveau service worker efface l'ancien cache : les fichiers des versions précédentes ne s'accumulent plus.
 */
function serviceWorkerVersion(): Plugin {
  let outDir = 'dist';
  return {
    name: 'tcsay-sw-version',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    writeBundle() {
      const file = `${outDir}/sw.js`;
      const id = `tcsay-${commit()}-${Date.now().toString(36)}`;
      const source = String(readFileSync(file, 'utf8'));
      if (!source.includes("const VERSION = 'tcsay-dev';")) throw new Error('sw.js : ligne VERSION introuvable');
      writeFileSync(file, source.replace("const VERSION = 'tcsay-dev';", `const VERSION = '${id}';`));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorkerVersion()],
  define: {
    __APP_VERSION__: JSON.stringify(`${commit()} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`),
  },
  server: {
    port: 5173,
    // Les appels /api passent par Vite vers l'API NestJS : pas de CORS en développement.
    proxy: { '/api': 'http://localhost:3000' },
    // Partage provisoire depuis le PC (tunnel Cloudflare) : adresse https://….trycloudflare.com.
    allowedHosts: ['.trycloudflare.com'],
  },
});
