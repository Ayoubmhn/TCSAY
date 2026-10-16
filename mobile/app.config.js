const fs = require('node:fs');
const path = require('node:path');

/**
 * Complète app.json (gardé tel quel, avec le projectId EAS) :
 * - notifications du téléphone (expo-notifications, version 0.3) ;
 * - fichier Firebase google-services.json : variable de fichier EAS GOOGLE_SERVICES_JSON pour le build dans le cloud,
 *   sinon ./google-services.json en local (jamais dans Git). Sans lui, l'application marche mais sans notifications.
 */
module.exports = ({ config }) => {
  const local = path.join(__dirname, 'google-services.json');
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? './google-services.json' : undefined);
  return {
    ...config,
    version: '0.3.0',
    android: {
      ...config.android,
      versionCode: Math.max(3, config.android?.versionCode ?? 0),
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    plugins: [
      ...(config.plugins ?? []).filter((p) => (Array.isArray(p) ? p[0] : p) !== 'expo-notifications'),
      ['expo-notifications', { icon: './assets/android-icon-monochrome.png', color: '#5a5acd', defaultChannel: 'default' }],
    ],
  };
};
