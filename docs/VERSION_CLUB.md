# Version du club

Un seul code, deux mises en ligne :

| | Version complète (la vôtre) | Version du club |
|---|---|---|
| Code | le même dépôt | le même dépôt |
| API (Render) | `tcsay-demo` | `tcsay-club` |
| Site (Vercel) | `tcsay` (renvoie `/api` vers la démo) | projet séparé, `VITE_API_URL` = API du club |
| Base (Neon) | démo (données fictives) | **base du club** (données réelles), jamais la démo |
| Modules | tous | ceux validés ci-dessous |

Une correction faite dans le code profite aux deux versions au prochain déploiement.

## Modules validés pour le club

Inclus :
- **Socle** : connexion, comptes et autorisations, sécurité et journal des actions, paramètres (français et anglais), emails et notifications.
- **Membres** : saisons, catégories, terrains, joueurs, parents (invitations), entraîneurs et personnel, import Excel, réinscriptions, fiche A4.
- **Caisse** : tarifs, cotisations et tranches, encaissement et reçus, retards et rappels, accès après paiement, salaires, dépenses, statistiques financières, mises à jour par fichier.
- **Entraînement** : groupes, planning, présences (aussi sans réseau), absences des entraîneurs.
- **Terrains** : réservations, règles anti-abus.
- **Compétition** : matchs point par point, tournois.
- **Communication** : messages du club, événements, albums photos, réclamations, notifications push.
- **Administration** : tableau de bord, rapports de fin de saison (dépôt des anciens rapports comme repère), lecture des photos par IA (à régler, désactivée tant que le président ne l'active pas), comptes IJIN.
- **Application** : site installable, hors connexion, application Android.

Coupés pour le moment (`MODULES_COUPES`) :

| Clé | Module |
|---|---|
| `arabe` | Langue arabe de l'application (les rapports de fin de saison restent en arabe) |
| `budget` | Projets et budget (devis, budget de saison, trésorerie) |
| `disponibilites` | Disponibilités et assistant de créneau |
| `import-historique` | Import historique des saisons passées |
| `evaluation-seances` | Objectif et évaluation des séances, suivi et progression |
| `bilans` | Bilans trimestriels, niveau, suivi technique |
| `exercices` | Exercices à la maison |

Un module coupé disparaît du menu, des écrans, du préchargement sans réseau et de « Accès après paiement » ; ses routes répondent 404 (même au président). Ses tables restent en base, vides.

**Anciens rapports comme repère** : Saisons › créer la saison passée (ex. 2024-2025) puis la passer en « Historique », ensuite Réglages › Rapports de fin de saison › choisir cette saison › déposer le Word, le PDF ou la photo.

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
   - `CORS_ORIGIN` et `APP_URL` : l'adresse du site du club (étape 4), ex. `https://tcsay-club.vercel.app` ;
   - emails (`MAIL_TRANSPORT`, `MAIL_FROM` et leurs clés, docs/MAILING.md), Telegram (docs/ALERTES_TELEGRAM.md), `GEMINI_API_KEY` si l'IA est utilisée.
4. **Site** : Vercel › Add New › Project › ce dépôt, *Root Directory* `web`, nom `tcsay-club`, variable `VITE_API_URL` = `https://tcsay-club.onrender.com` (sans `/api/v1`) › Deploy. Puis reportez l'adresse du site dans `CORS_ORIGIN` et `APP_URL` de Render.
5. **Vérifier** : ouvrez le site du club, connectez-vous avec le compte du président : le menu ne montre pas les modules coupés, Paramètres › Langue propose français et anglais seulement.
6. **Application Android du club** (facultatif) : construire l'APK avec `EXPO_PUBLIC_WEB_URL` = adresse du site du club (mobile/README.md).

Conseils :
- Le service gratuit de Render s'endort après 15 minutes sans visite : pour le club, l'offre payante évite la première page lente (sinon UptimeRobot sur `/api/v1/health`).
- Mises à jour de la base du club : toujours `npm run db:migrate` depuis votre PC (sauvegarde puis migration), jamais `migrate reset` ni `migrate dev` (docs/BASE_DE_DONNEES.md).
- Déploiement manuel seulement (`autoDeploy: false`) : la version du club ne change que quand vous le décidez.

## Contrôle automatique

`npm run test:modules` (dans `api/`, base de démo) lance l'API avec les modules coupés du club et vérifie que leurs routes répondent 404 et que les autres restent ouvertes. Il tourne aussi sur GitHub Actions à chaque push.
