import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
// @ts-ignore -- module Node présent à la construction (les types de Node ne sont pas installés dans le projet web)
import { execSync } from 'node:child_process';
// @ts-ignore -- idem
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * Version démo (VITE_DEMO=1 sur le projet Vercel de la démo, ou `--mode demo` en local) : nom « TCSAY Démo » (onglet,
 * site installé), icônes et favicon avec le bandeau « DÉMO » (public/demo). Sans elle : nom et icônes du club. Le dossier
 * demo/ n'est jamais publié.
 */
function demoVariant(demo: boolean): Plugin {
  let outDir = 'dist';
  return {
    name: 'tcsay-demo-variant',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    transformIndexHtml(html) {
      if (!demo) return html;
      return html
        .replace('<title>TCSAY · Tennis Club de Sayada</title>', '<title>TCSAY Démo · Tennis Club de Sayada</title>')
        .replace('<meta name="apple-mobile-web-app-title" content="TCSAY" />', '<meta name="apple-mobile-web-app-title" content="TCSAY Démo" />');
    },
    writeBundle() {
      const icons = `${outDir}/demo/icons`;
      if (demo) {
        if (!existsSync(icons)) throw new Error('public/demo/icons introuvable');
        cpSync(icons, `${outDir}/icons`, { recursive: true });
        cpSync(`${outDir}/demo/favicon.png`, `${outDir}/favicon.png`);
        const file = `${outDir}/manifest.webmanifest`;
        const manifest = JSON.parse(String(readFileSync(file, 'utf8')));
        manifest.name = 'TCSAY Démo · Tennis Club de Sayada';
        manifest.short_name = 'TCSAY Démo';
        writeFileSync(file, JSON.stringify(manifest, null, 2));
      }
      rmSync(`${outDir}/demo`, { recursive: true, force: true });
    },
  };
}

/**
 * Variantes : `vite --mode demo` (= VITE_DEMO=1) pour la démo, `vite --mode club` pour la version du club en local
 * (pas de boutons de comptes de démo). Valeurs lues par le site dans import.meta.env.VITE_DEMO / VITE_CLUB.
 */
export default defineConfig(({ mode }) => {
  const demo = process.env.VITE_DEMO === '1' || mode === 'demo';
  const club = mode === 'club';
  return {
    plugins: [react(), tailwindcss(), serviceWorkerVersion(), demoVariant(demo)],
    define: {
      __APP_VERSION__: JSON.stringify(`${commit()} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`),
      'import.meta.env.VITE_DEMO': JSON.stringify(demo ? '1' : ''),
      'import.meta.env.VITE_CLUB': JSON.stringify(club ? '1' : ''),
    },
    server: {
      port: 5173,
      // Les appels /api passent par Vite vers l'API NestJS : pas de CORS en développement.
      proxy: { '/api': 'http://localhost:3000' },
      // Partage provisoire depuis le PC (tunnel Cloudflare) : adresse https://….trycloudflare.com.
      allowedHosts: ['.trycloudflare.com'],
    },
  };
});
