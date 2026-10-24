# Version du club

Un seul code, deux mises en ligne :

| | Version complète (la vôtre) | Version du club |
|---|---|---|
| Code | le même dépôt | le même dépôt |
| Branche | `claude/tcsay-platform-dev-p3t75p` (développement, essais) | `main` (stable : seulement ce qui est validé ; branche par défaut de GitHub) |
| Nom de l'application | **TCSAY Démo** (icône avec bandeau « DÉMO ») | **TCSAY** |
| Application Android | `tn.tcsay.demo` (`eas build --profile demo`) | `tn.tcsay.app` (`--profile preview` ou `production`) |
| API (Render) | `tcsay-demo` | `tcsay-club` |
| Site (Vercel) | `tcsay-demo.vercel.app` (projet `tcsay-demo`, `VITE_DEMO=1`, renvoie `/api` vers la démo) | `tcsay.vercel.app` (projet `tcsay`, branche `main`, `VITE_API_URL` = API du club) |
| Base (Neon) | démo (données fictives) | **base du club** (données réelles), jamais la démo |
| Modules | tous | ceux validés ci-dessous |

Une correction faite dans le code profite aux deux versions : la démo la reçoit tout de suite, le club quand vous la recopiez sur `main`.

**Qui fait quoi** : Neon = la base de données ; Render = l'API (le serveur : connexion, paiements, emails, notifications, tâches automatiques, toujours en marche) ; Vercel = le site (les pages affichées dans le navigateur et l'application). Les trois sont nécessaires.

## Mettre une amélioration dans la version du club

Quand une amélioration est testée sur la démo :
```bash
git checkout main
git pull origin main
git merge claude/tcsay-platform-dev-p3t75p   # ou seulement un commit : git cherry-pick <commit>
git push origin main
git checkout claude/tcsay-platform-dev-p3t75p
```
Le site du club (Vercel, projet `tcsay`, branche de production `main`) se met à jour tout seul. Si l'API change : Render › `tcsay-club` › **Manual Deploy** (et `npm run db:migrate` sur la base du club si le commit annonce un changement de structure).

## Modules validés pour le club

Inclus :
- **Socle** : connexion, comptes et autorisations, sécurité et journal des actions, paramètres (français et anglais), emails et notifications.
- **Membres** : saisons, catégories, terrains, joueurs, parents (invitations), entraîneurs et personnel, import Excel, réinscriptions, fiche A4.
- **Caisse** : tarifs, cotisations et tranches, encaissement et reçus, retards et rappels, accès après paiement, salaires, dépenses, statistiques financières, mises à jour par fichier.
- **Entraînement** : groupes, planning, présences (aussi sans réseau), absences des entraîneurs.
- **Terrains** : réservations, règles anti-abus.
- **Compétition** : matchs point par point, tournois.
- **Communication** : messages du club, événements, albums photos, réclamations, notifications push.
- **Administration** : tableau de bord, rapports de fin de saison (anciens rapports déposés comme repère), import historique des saisons passées, lecture des photos par IA (à régler, désactivée tant que le président ne l'active pas), comptes IJIN.
- **Application** : site installable, hors connexion, application Android.

Coupés pour le moment (`MODULES_COUPES`) :

| Clé | Module |
|---|---|
| `arabe` | Langue arabe de l'application (les rapports de fin de saison restent en arabe) |
| `budget` | Projets et budget (devis, budget de saison, trésorerie) |
| `disponibilites` | Disponibilités et assistant de créneau |
| `evaluation-seances` | Objectif et évaluation des séances, suivi et progression |
| `bilans` | Bilans trimestriels, niveau, suivi technique |
| `exercices` | Exercices à la maison |

Un module coupé disparaît du menu, des écrans, du préchargement sans réseau et de « Accès après paiement » ; ses routes répondent 404 (même au président). Ses tables restent en base, vides.

**Anciens rapports comme repère** : Réglages › Import historique › « + Saison passée » (ex. 2024-2025), puis Réglages › Rapports de fin de saison › choisir cette saison › déposer le Word, le PDF ou la photo. Les joueurs, recettes et dépenses des saisons passées s'importent aussi dans Import historique (à mettre à jour plus tard).

## Rallumer un module plus tard

1. Render › `tcsay-club` › Environment › `MODULES_COUPES` : retirez la clé (ex. enlever `,bilans`).
2. **Save, rebuild and deploy** (ou Manual Deploy). Le module apparaît au prochain chargement de la page, sans migration.

Le président ne peut pas rallumer un module depuis l'application : c'est un réglage de l'installation.

## Mise en ligne (une fois, par vous)

1. **Base** : neon.tech › nouveau projet « tcsay-club » (région Frankfurt) › copiez l'adresse *Direct connection* (avec `?sslmode=require`). Ne l'envoyez à personne.
2. **Préparer la base depuis votre PC** (base vierge, jamais de seed) :
   ```powershell
   cd api
   $env:DATABASE_URL="<adresse Neon du club>"; $env:TCSAY_PRODUCTION="true"
   npm run db:migrate     # crée les tables (répondez OUI)
   npm run db:init-prod   # demande prénom, nom, email et mot de passe du président
   ```
3. **API** : Render › Blueprints › ce dépôt › **Sync** : Render propose le nouveau service `tcsay-club`. Saisissez les valeurs secrètes demandées :
   - `DATABASE_URL` : l'adresse Neon du club ;
   - `TCSAY_SECRET_KEY` : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (gardez-la : perdue = mots de passe IJIN illisibles) ;
   - `CORS_ORIGIN` et `APP_URL` : l'adresse du site du club (étape 4), `https://tcsay.vercel.app` ;
   - emails (`MAIL_TRANSPORT`, `MAIL_FROM` et leurs clés, docs/MAILING.md), Telegram (docs/ALERTES_TELEGRAM.md), `GEMINI_API_KEY` si l'IA est utilisée.
4. **Sites (Vercel)** : l'adresse `tcsay.vercel.app` passe au club, la démo prend `tcsay-demo.vercel.app`. Dans cet ordre (la démo n'est jamais coupée) :
   - **Démo d'abord** : Add New › Project › ce dépôt, nom **`tcsay-demo`**, *Root Directory* `web`, variable `VITE_DEMO` = `1`, Deploy ; Settings › Git › *Production Branch* = `claude/tcsay-platform-dev-p3t75p`. Puis Render › `tcsay-demo` › `APP_URL` = `https://tcsay-demo.vercel.app` › Save.
   - **Puis le club** sur l'ancien projet **`tcsay`** : Settings › Environment Variables : **supprimez** `VITE_DEMO`, ajoutez `VITE_API_URL` = `https://tcsay-club.onrender.com` (sans `/api/v1`) ; Settings › Git › *Production Branch* = `main` ; Deployments › Redeploy.
5. **Vérifier** : ouvrez le site du club, connectez-vous avec le compte du président : le menu ne montre pas les modules coupés, Paramètres › Langue propose français et anglais seulement.
6. **Application Android du club** (facultatif) : `npx eas-cli@latest build -p android --profile preview` (adresse du site du club dans `eas.json`, mobile/README.md). La démo : `--profile demo`.

## Reprendre la base locale (votre PC) dans la version réelle

À faire **à la place** de l'étape 2 (`db:init-prod`) si vous avez déjà saisi les vraies données sur votre PC (base `tcsay_prod`). La base locale n'est pas modifiée : on la copie.

1. **Vérifier la base locale** (dans `api/.env`, `DATABASE_URL` = votre base locale) :
   ```powershell
   cd api
   npm run db:status      # « Contenu : … compte(s), … joueur(s) » sans « données de DÉMO » : jamais la base de démo
   npm run db:migrate     # met la base locale à jour (sauvegarde automatique avant)
   npm run db:backup      # → api/backups/AAAA-MM-JJ_HHhMM_tcsay_prod_sauvegarde.json
   ```
2. **Créer les tables dans la base Neon du club** (base vide), dans le même terminal :
   ```powershell
   $env:DATABASE_URL="<adresse Neon du club>"; $env:TCSAY_PRODUCTION="true"
   npm run db:migrate     # répondez OUI
   ```
3. **Copier les données** :
   ```powershell
   npm run db:restore -- backups/<fichier de l'étape 1>.json
   npm run db:status      # mêmes nombres de comptes, joueurs et paiements que la base locale
   ```
   La restauration refuse une base qui contient déjà des comptes : elle ne mélange jamais deux bases.
4. Fermez le terminal (les variables `$env:` disparaissent) : votre `api/.env` pointe toujours sur la base locale.
5. Ensuite, **une seule base fait foi** : la base Neon du club. Ne saisissez plus rien en local (sinon il faudrait recommencer, sur une base Neon vide).

Points d'attention :
- La sauvegarde JSON contient des données de mineurs : gardez-la hors de GitHub (`api/backups/` est déjà exclu), supprimez les copies inutiles.
- Neon gratuit : 0,5 Go. Les photos et justificatifs sont en base : la taille du fichier de sauvegarde en donne une idée (Neon › Monitoring après la copie).
- Les mots de passe des comptes sont copiés (empreintes) : chacun garde le sien. Les mots de passe IJIN restent lisibles seulement avec la **même** `TCSAY_SECRET_KEY` que sur votre PC : mettez cette même clé dans Render.

Conseils :
- Le service gratuit de Render s'endort après 15 minutes sans visite : pour le club, l'offre payante évite la première page lente (sinon UptimeRobot sur `/api/v1/health`).
- Mises à jour de la base du club : toujours `npm run db:migrate` depuis votre PC (sauvegarde puis migration), jamais `migrate reset` ni `migrate dev` (docs/BASE_DE_DONNEES.md).
- Déploiement manuel seulement (`autoDeploy: false`) : la version du club ne change que quand vous le décidez.

## Contrôle automatique

`npm run test:modules` (dans `api/`, base de démo) lance l'API avec les modules coupés du club et vérifie que leurs routes répondent 404 et que les autres restent ouvertes. Il tourne aussi sur GitHub Actions à chaque push.
