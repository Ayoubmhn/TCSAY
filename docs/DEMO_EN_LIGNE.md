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

## Plus tard : le vrai domaine
Avec `tennisclubdesayada.tn` : Render › Settings › Custom Domains, ou un VPS (voir le sprint S12).
