const fs = require('node:fs');
const path = require('node:path');

/**
 * Complète app.json (gardé tel quel, avec le projectId EAS) :
 * - notifications du téléphone (expo-notifications, version 0.3) ; liens du site ouverts dans l'application (0.4) ;
 * - fichier Firebase google-services.json : variable de fichier EAS GOOGLE_SERVICES_JSON pour le build dans le cloud,
 *   sinon ./google-services.json en local (jamais dans Git). Sans lui, l'application marche mais sans notifications.
 */
module.exports = ({ config }) => {
  const local = path.join(__dirname, 'google-services.json');
  // Liens du site (emails, SMS) ouverts dans l'application si elle est installée (Android App Links, preuve :
  // web/public/.well-known/assetlinks.json avec l'empreinte SHA-256 de la clé de signature).
  const host = new URL(process.env.EXPO_PUBLIC_WEB_URL || 'https://tcsay.vercel.app').host;
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? './google-services.json' : undefined);
  return {
    ...config,
    version: '0.4.0',
    android: {
      ...config.android,
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
