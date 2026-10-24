# TCSAY mobile (Expo, React Native)

Application Android / iPhone du club, dans `mobile/`, qui parle à la même API que le site (`api/`).
Expo SDK 57 · expo-router (écrans dans `src/app/`) · TanStack Query · composants faits main (`src/components/ui.tsx`, aucune bibliothèque d'interface) · police Montserrat.

## Fonctionnement (version 0.2)

L'application affiche **le site TCSAY complet** (tous les modules, identiques au web et toujours à jour) dans une vue
plein écran (`react-native-webview`, `src/app/index.tsx`) : bouton retour Android, écran « Pas de connexion »,
liens externes (téléphone, email, WhatsApp, vidéos) ouverts dans l'application correspondante, bandes système
à la couleur du thème du site. Le site reconnaît l'application (user-agent `TCSAYApp/…`) : « Rester connecté »
coché d'office, carte « Installer l'application » masquée.

- Adresse du site : `EXPO_PUBLIC_WEB_URL` (dans `eas.json`) : `https://tcsay.vercel.app` (club, profils `preview` et `production`), `https://tcsay-demo.vercel.app` (profil `demo`).
- Limites : impression et téléchargement de fichiers (reçus PDF) à faire depuis un navigateur.
- **Notifications du téléphone** (version 0.3, `expo-notifications`, `src/push.ts`) : au premier lancement,
  l'application demande l'autorisation, obtient le jeton push de l'appareil et le donne au site, qui le rattache au
  compte connecté (`POST /push/native`, retiré à la déconnexion). Chaque notification de la cloche part aussi sur le
  téléphone par le service push d'Expo (`api/src/push/expo-push.ts`), même application fermée ; la toucher ouvre la
  page concernée. Paramètres › « Notifications du téléphone » : état, essai, réglages Android.
- Les écrans natifs commencés (lot 1, lots 2–3 partiels) sont gardés dans `src/natif/` et `src/wip/` (hors routes).

## Liens ouverts dans l'application (version 0.4)

Un lien du site reçu par email, SMS ou WhatsApp (`https://tcsay.vercel.app/paiements`…) ouvre l'application si elle
est installée, sinon le navigateur (Android App Links) :
- `app.config.js` : filtre d'adresse vérifié pour l'hôte de `EXPO_PUBLIC_WEB_URL` ;
- `src/app/+native-intent.tsx` : la page demandée est ouverte dans la vue ;
- preuve côté site : `web/public/.well-known/assetlinks.json` (paquet `tn.tcsay.app` + empreinte SHA-256 de la clé de
  signature EAS, `npx eas-cli credentials -p android`). Publication Google Play : ajouter aussi l'empreinte « App signing »
  de la Play Console. Nouveau domaine : redéployer le site avec ce fichier, changer `EXPO_PUBLIC_WEB_URL`, reconstruire l'APK.
- Vérifier sur le téléphone : Paramètres › Applications › TCSAY › Ouvrir par défaut › « tcsay.vercel.app » coché.



Android remet les notifications par **Firebase Cloud Messaging** (gratuit). Sans ces réglages, l'application marche
mais affiche « Notifications indisponibles ».

1. **Firebase** : https://console.firebase.google.com › *Ajouter un projet* (`TCSAY`, Analytics inutile).
2. Dans le projet : icône Android › *nom du package* **`tn.tcsay.app`** › *Enregistrer* › **télécharger
   `google-services.json`**, le poser dans `mobile/` (ignoré par Git, ne jamais le committer).
3. Le donner au build EAS (variable de fichier) :
   ```bash
   cd mobile
   npx eas-cli@latest env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment preview
   ```
4. **Clé d'envoi FCM pour Expo** : Firebase › ⚙ *Paramètres du projet* › *Comptes de service* › *Générer une
   nouvelle clé privée* (fichier JSON, secret : ne jamais le committer). Puis :
   ```bash
   npx eas-cli@latest credentials -p android
   ```
   › *preview* (puis *production*) › *Google Service Account* › *Manage your Google Service Account Key for Push
   Notifications (FCM V1)* › *Upload a new service account key* › choisir le fichier JSON.
5. Construire le nouvel APK : `npx eas-cli@latest build -p android --profile preview`, l'installer, accepter
   « Autoriser les notifications », puis Paramètres › Notifications du téléphone › *Envoyer un essai*.

L'API (Render) n'a besoin d'aucune clé : elle envoie au service push d'Expo (`EXPO_ACCESS_TOKEN` facultatif).

## 1. Préparer (une fois)

```bash
cd mobile
npm install
```

L'API doit tourner sur le PC : `cd api && npm run start:dev` (port 3000).

## 2. Tester sur l'émulateur Android Studio

1. Installer **Android Studio** (avec Android SDK et un JDK 17, fournis par l'installation).
2. Android Studio › **Device Manager** › **Create Virtual Device** › Pixel 7 › image Android 15 (API 35) › Démarrer.
3. Variables d'environnement Windows (une fois) : `ANDROID_HOME = C:\Users\<vous>\AppData\Local\Android\Sdk`
   et ajouter `%ANDROID_HOME%\platform-tools` au `Path`. Rouvrir le terminal.
4. Avec l'émulateur démarré :
   ```bash
   cd mobile
   npx expo run:android
   ```
   La première fois, la compilation prend 5 à 15 minutes ; l'application s'ouvre ensuite toute seule et se recharge à chaque enregistrement de fichier.
5. Serveur par défaut dans l'émulateur : `http://10.0.2.2:3000` (= le PC). Rien à changer.

## 3. Tester sur un vrai téléphone Android

**A. Par câble USB (développement)**
1. Sur le téléphone : Paramètres › À propos › appuyer 7 fois sur « Numéro de build » ; puis Options pour les développeurs › **Débogage USB**.
2. Brancher le téléphone, accepter l'autorisation, vérifier avec `adb devices`.
3. `npx expo run:android` (choisir le téléphone si l'émulateur est aussi ouvert).
4. Sur l'écran de connexion, toucher « Serveur : … modifier » et saisir `http://IP-du-PC:3000`
   (IP : `ipconfig` › Adresse IPv4, même Wi-Fi que le téléphone ; autoriser Node.js dans le pare-feu Windows).

**B. Fichier APK à installer (sans câble)**
- Sur le PC (Android Studio installé) :
  ```bash
  cd mobile
  npx expo prebuild --platform android --clean     # obligatoire après l'ajout d'un module natif (WebView)
  cd android
  EXPO_PUBLIC_WEB_URL=https://tcsay.vercel.app ./gradlew assembleRelease
  ```
  APK : `mobile/android/app/build/outputs/apk/release/app-release.apk` (signé avec la clé de débogage : pour tester seulement).
- Ou dans le cloud Expo (compte gratuit sur expo.dev, sans Android Studio) :
  ```bash
  npx eas-cli@latest login
  npx eas-cli@latest build -p android --profile demo      # « TCSAY Démo » (tn.tcsay.demo) → site de la démo
  npx eas-cli@latest build -p android --profile preview   # « TCSAY » du club (tn.tcsay.app) → site du club
  ```
  À la fin, un lien et un QR code téléchargent l'APK. Les deux applications s'installent côte à côte (identifiants
  différents). Adresses : club `https://tcsay.vercel.app`, démo `https://tcsay-demo.vercel.app` (`EXPO_PUBLIC_WEB_URL`
  d'`eas.json`).
- **En local** (téléphone sur le même Wi-Fi que le PC) : site lancé avec `npm run dev:demo -- --host` (ou `dev:club`) dans `web/`,
  puis `EXPO_PUBLIC_WEB_URL=http://<IP du PC>:5173 npx expo start` ici et Expo Go (docs/VERSION_CLUB.md).
- **Démo** (`APP_VARIANT=demo`, `app.config.js`) : nom « TCSAY Démo », icônes `assets/demo/` (bandeau « DÉMO »).
  Notifications : ajoutez l'application `tn.tcsay.demo` dans Firebase (Paramètres du projet › Ajouter une application
  Android), puis remplacez `google-services.json` (il contient alors les deux) ; sans cela l'APK de démo marche, sans
  notifications. Liens des emails ouverts dans l'application : ajoutez l'empreinte SHA-256 de la clé `tn.tcsay.demo`
  (expo.dev › Credentials) dans `web/public/.well-known/assetlinks.json`.
- Envoyer l'APK sur le téléphone (câble, Drive, WhatsApp…), l'ouvrir, autoriser « Installer des applications inconnues ».
- Au premier lancement, régler le serveur : `http://IP-du-PC:3000` (même Wi-Fi) ou l'adresse en ligne du club (`https://…`).

## 4. Vérifications avant de livrer

```bash
npm run typecheck                         # TypeScript
npx expo export --platform android        # le bundle Android se compile
```

## Notes

- **Adresse du serveur** : par défaut `EXPO_PUBLIC_API_URL`, sinon `http://10.0.2.2:3000` (émulateur Android). Modifiable sur l'écran de connexion, mémorisée sur le téléphone.
- **Session** : jeton gardé chiffré (expo-secure-store, Keystore Android) ; « Rester connecté » = 30 jours.
- **HTTP en clair** autorisé (`expo-build-properties`, `usesCleartextTraffic`) pour tester sur le Wi-Fi local ; en production, utiliser l'adresse `https`.
- **Notifications push** sur le téléphone : voir « Notifications du téléphone » ci-dessus (Firebase Cloud Messaging par Expo).
- **Icônes** : générées depuis le logo haute définition `docs/logo/logo-tcsay-source.png` (794 px, fond transparent) : site (`web/public/logo-tcsay.png`, `favicon.png`, `icons/`) et application (`mobile/assets/`). L'icône du téléphone change au prochain APK.
- Ne jamais modifier `android/` ou `ios/` à la main (dossiers générés, ignorés par git) : régler `app.json`.
