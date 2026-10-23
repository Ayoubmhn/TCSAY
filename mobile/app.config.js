const fs = require('node:fs');
const path = require('node:path');

/**
 * Complète app.json (gardé tel quel, avec le projectId EAS) :
 * - notifications du téléphone (expo-notifications, version 0.3) ; liens du site ouverts dans l'application (0.4) ;
 * - fichier Firebase google-services.json : variable de fichier EAS GOOGLE_SERVICES_JSON pour le build dans le cloud,
 *   sinon ./google-services.json en local (jamais dans Git). Sans lui, l'application marche mais sans notifications.
 * - APP_VARIANT=demo (profils « demo » d'eas.json) : application « TCSAY Démo », identifiant tn.tcsay.demo (installable à
 *   côté de la vraie, tn.tcsay.app) et icônes avec le bandeau « DÉMO » (assets/demo).
 */
/** Le fichier Firebase contient-il cette application ? Sinon le build Android échoue : on s'en passe (sans notifications). */
function hasClient(file, pkg) {
  try {
    const json = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf8'));
    return (json.client ?? []).some((c) => c.client_info?.android_client_info?.package_name === pkg);
  } catch {
    return true; // illisible ici (build dans le cloud) : on le garde
  }
}

module.exports = ({ config }) => {
  const demo = process.env.APP_VARIANT === 'demo';
  const pkg = demo ? 'tn.tcsay.demo' : config.android.package;
  const local = path.join(__dirname, 'google-services.json');
  // Liens du site (emails, SMS) ouverts dans l'application si elle est installée (Android App Links, preuve :
  // web/public/.well-known/assetlinks.json avec l'empreinte SHA-256 de la clé de signature).
  const host = new URL(process.env.EXPO_PUBLIC_WEB_URL || 'https://tcsay.vercel.app').host;
  const firebase = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? './google-services.json' : undefined);
  const googleServicesFile = firebase && hasClient(firebase, pkg) ? firebase : undefined;
  if (firebase && !googleServicesFile) console.warn(`google-services.json ne contient pas ${pkg} : application sans notifications (ajoutez-la dans Firebase).`);
  return {
    ...config,
    ...(demo ? { name: 'TCSAY Démo', icon: './assets/demo/icon.png' } : {}),
    version: '0.4.0',
    android: {
      ...config.android,
      package: pkg,
      ...(demo
        ? {
            adaptiveIcon: {
              ...config.android.adaptiveIcon,
              foregroundImage: './assets/demo/android-icon-foreground.png',
              monochromeImage: './assets/demo/android-icon-monochrome.png',
            },
          }
        : {}),
      versionCode: Math.max(4, config.android?.versionCode ?? 0),
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host, pathPrefix: '/' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    plugins: [
      ...(config.plugins ?? []).filter((p) => (Array.isArray(p) ? p[0] : p) !== 'expo-notifications'),
      ['expo-notifications', { icon: './assets/android-icon-monochrome.png', color: '#5a5acd', defaultChannel: 'default' }],
    ],
  };
};
