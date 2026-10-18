# Démo en ligne provisoire (tests par les collègues)

Données de **démonstration** uniquement : aucun vrai joueur et aucune donnée de mineur.

## Les acteurs et les comptes de démo
Sur la page de connexion de la démo, un bouton par compte se connecte en un clic. Le mot de passe est figé : les testeurs ne peuvent pas le changer.

| Acteur | Ce qu'il fait | Compte de démo | Mot de passe |
|---|---|---|---|
| **Président** | Tous les accès ; règle les autorisations de chaque rôle ; statistiques | `admin@tcsay.tn` | `admin1234` |
| **Agent administratif** | Joueurs, parents, entraîneurs ; encaissements et reçus ; salaires ; réservations ; planning ; emails | `agent@tcsay.tn` | `temporaire` |
| **Agent superviseur** | Statistiques du club seulement | `superviseur@tcsay.tn` | `temporaire` |
| **Directeur technique** | Entraîneurs, groupes, emploi du temps, absences des entraîneurs, présences ; **aussi entraîneur** (deux espaces) | `dt@tcsay.tn` | `temporaire` |
| **Entraîneur (coach)** | Ses séances, présences pendant la séance en cours, ses absences, ses salaires, réservation pour séances privées ; ne voit jamais les cotisations | `iheb@exemple.tn` | `temporaire` |
| **Parent** | Pour chacun de ses enfants : paiements (n° des reçus), séances, absences, réservation de terrain | `sana.benali@exemple.tn` | `temporaire` |
| **Joueur** | Ses paiements, séances, absences, réservation de terrain | `omar.trabelsi@exemple.tn` | `temporaire` |

- Un compte peut cumuler plusieurs rôles : il choisit son **espace** dans le menu (ex. le directeur technique passe dans l'espace entraîneur).
- Le président peut modifier les droits de chaque rôle dans *Autorisations*.

## Option A : tout de suite, depuis votre PC (lien temporaire)
Le lien marche **tant que votre PC est allumé** et que l'API et le site tournent.
1. Installez l'outil Cloudflare (une seule fois, dans PowerShell) : `winget install Cloudflare.cloudflared`
2. Lancez l'API et le site comme d'habitude (`npm run start:dev` dans `api`, `npm run dev` dans `web`).
3. Dans un troisième terminal : `cloudflared tunnel --url http://localhost:5173`
4. Copiez l'adresse affichée (`https://xxxx.trycloudflare.com`) et envoyez-la aux collègues.

Sur ce lien, les boutons de démo ne s'affichent pas (mode développement) : donnez les identifiants du tableau. Pour un lien partagé, mieux vaut que tout le monde garde le même mot de passe : lancez une fois `npx prisma db seed` puis évitez de changer les mots de passe. Pour figer les mots de passe, ajoutez `DEMO_MODE=true` dans `api/.env` avant le seed, puis redémarrez l'API.

## Option B : adresse fixe gratuite (Render), sans votre PC
Une seule adresse `https://tcsay-demo.onrender.com` (API + site), base PostgreSQL incluse.
1. Créez un compte sur https://render.com (connexion avec GitHub).
2. **New › Blueprint**, choisissez le dépôt `TCSAY` : Render lit `render.yaml` (base `tcsay-db` + service `tcsay-demo`). Cliquez sur **Apply**.
3. Le premier déploiement prend environ 5 à 10 minutes : migrations, puis chargement des données de démo (base vide seulement).
4. Envoyez l'adresse du service aux collègues.

Limites de l'offre gratuite (conditions Render, à vérifier sur leur site) :
- le service **s'endort après environ 15 minutes sans visite** : la première page peut mettre environ 1 minute à s'afficher ;
- la base gratuite a une **durée limitée** (environ 30 jours), puis il faut la recréer ou passer à l'offre payante.

**Remettre les données à zéro :** Render › tcsay-demo › Environment › `RESET_DEMO_DATA` = `true`, **Save** (redéploiement). Une fois fait, remettez `false`.

**Emails :** pas envoyés pendant les tests (ils apparaissent « Échec » dans *Emails envoyés*). Pour un test réel, ajoutez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` dans *Environment*.

## Option C : base sur Neon, API sur Render, site sur Vercel (configuration actuelle)
1. Neon : base PostgreSQL (voir « Base sur Neon » ci-dessous). Render : service `tcsay-demo` (API seule : `SERVE_WEB=false`, `TRUST_PROXY_HOPS=2`, build `cd api && npm ci --include=dev && npm run build`).
2. Vercel : projet importé depuis GitHub, **Root Directory `web`**, variable `VITE_DEMO=1`, branche de production `claude/tcsay-platform-dev-p3t75p`. `web/vercel.json` renvoie `/api/*` vers `https://tcsay-demo.onrender.com` (même adresse pour le navigateur : pas de CORS).
3. Render › tcsay-demo › Environment : `APP_URL` = l'adresse Vercel (liens des emails).
4. Application mobile : `mobile/eas.json` (profil `preview`) pointe sur l'adresse Render.

## Base sur Neon (au lieu de la base gratuite de Render)
La base gratuite de Render est **supprimée au bout de 30 jours** ; celle de Neon n'expire pas (0,5 Go, mise en veille sans visite, réveil en ~1 s). La lenteur du premier chargement vient de l'**API** Render endormie (plan gratuit), pas de la base : voir « Garder l'API éveillée ».

1. **Créer la base** : neon.tech › Sign up › New project : nom `tcsay`, PostgreSQL 16, région **AWS Europe Central (Frankfurt)** (même région que Render).
2. **Copier l'adresse** : Dashboard › **Connect** › décocher **Connection pooling** (adresse *directe*, nécessaire à `prisma migrate`) › copier l'adresse `postgresql://…neon.tech/neondb?sslmode=require`. Elle contient le mot de passe : ne la mettez jamais dans le dépôt, ne l'envoyez à personne.
3. **Brancher Render** : Render › tcsay-demo › Environment › `DATABASE_URL` = cette adresse › **Save, rebuild and deploy**.
4. Au démarrage, `npm run start:demo` applique les migrations sur la base vide puis **charge les données de démo** (`seed-if-empty`). Vérifier dans les logs Render : « Base de données : neondb ».
5. **Garder les données déjà saisies sur Render** (facultatif, avant le point 3, depuis votre PC avec PostgreSQL 16 installé) :
   ```bash
   pg_dump --no-owner --no-acl -Fc "<External Database URL de Render>" -f tcsay-render.dump
   pg_restore --no-owner --no-acl -d "<adresse directe Neon>" tcsay-render.dump
   ```
   (Render › tcsay-db › Info › *External Database URL*.) Le dump contient des données : ne le commitez pas, supprimez-le après.
6. Quand tout marche : Render › tcsay-db › Settings › **Delete Database** (elle n'est plus utilisée ; le Blueprint ne la gère plus).
7. **Sauvegarde** : `npm run db:backup` avec `DATABASE_URL` = adresse Neon (depuis votre PC) ; Neon garde aussi un historique de 24 h (restauration à une heure donnée, plan gratuit).

### Garder l'API éveillée (plan gratuit)
L'API Render gratuite s'endort après 15 min sans visite (30 à 60 s d'attente ensuite). Gratuit : uptimerobot.com › New monitor › HTTP(s), adresse `https://tcsay-demo.onrender.com/api/v1/health`, toutes les **10 minutes**. Payant et sans veille : Render **Starter** (~7 $/mois), conseillé pour la mise en service au club.

## Plus tard : le vrai domaine
Avec `tennisclubdesayada.tn` : Render › Settings › Custom Domains, ou un VPS (voir le sprint S12).
