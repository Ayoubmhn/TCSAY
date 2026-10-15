# TCSAY mobile (Expo, React Native)

Application Android / iPhone du club, dans `mobile/`, qui parle à la même API que le site (`api/`).
Expo SDK 57 · expo-router (écrans dans `src/app/`) · TanStack Query · composants faits main (`src/components/ui.tsx`, aucune bibliothèque d'interface) · police Montserrat.

## Écrans livrés (lot 1)

| Espace | Écrans |
|---|---|
| Tous | Connexion (adresse du serveur réglable, mot de passe oublié), changement de mot de passe obligatoire, Notifications, Menu (changer d'espace), Paramètres (thème Auto / Clair / Sombre) |
| Joueur, parent | Accueil, Mes séances (14 jours), Mes paiements (tranches, reçus), Mes absences ; choix de l'enfant en haut |
| Entraîneur | Mes séances, Présences (pointage de la séance en cours), Mes salaires |
| Administration | Dashboard (le reste reste sur le site pour l'instant) |

À venir : lot 2 (réservation, matchs, tournois, suivi, exercices, bilans, disponibilités), lot 3 (gestion admin).

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
  npx expo prebuild --platform android
  cd android
  ./gradlew assembleRelease        # Windows : gradlew.bat assembleRelease
  ```
  APK : `mobile/android/app/build/outputs/apk/release/app-release.apk` (signé avec la clé de débogage : pour tester seulement).
- Ou dans le cloud Expo (compte gratuit sur expo.dev, sans Android Studio) :
  ```bash
  npx eas-cli@latest login
  npx eas-cli@latest build -p android --profile preview
  ```
  À la fin, un lien et un QR code téléchargent l'APK.
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
- **Notifications push** sur le téléphone : à brancher plus tard (Firebase Cloud Messaging, compte Google du club). En attendant : onglet Alertes, relu toutes les 60 s.
- **Icônes** : le logo source ne fait que 128 px ; fournir un logo haute définition (1024 px, fond transparent) pour des icônes nettes.
- Ne jamais modifier `android/` ou `ios/` à la main (dossiers générés, ignorés par git) : régler `app.json`.
