# Sécurité de l'application TCSAY

## Ce qui protège l'application (déjà dans le code)
| Protection | Détail |
|---|---|
| Mots de passe | Chiffrés (scrypt), jamais stockés en clair. Règles : 10 caractères, au moins une lettre et un chiffre, pas le nom / prénom / email / CIN, pas un mot courant. |
| Mot de passe temporaire | Changement obligatoire à la première connexion. |
| Essais de connexion | 5 échecs pour un identifiant (ou 20 depuis une même adresse) en 15 min → blocage 15 min. Même règle pour le « mot de passe actuel ». |
| Identifiants inconnus | Même message et même temps de réponse qu'un mauvais mot de passe (impossible de deviner qui a un compte). |
| Sessions | Jeton signé valable 12 h. Changer de mot de passe (ou recevoir de nouveaux identifiants) déconnecte les autres appareils. Compte désactivé = refusé immédiatement. |
| Droits | Vérifiés par le serveur sur chaque requête : rôle, espace, autorisation (`@Perm`). Le coach ne voit jamais les cotisations, le parent seulement ses enfants. |
| Données reçues | Validées ; champ inconnu = requête refusée. Fichiers Excel limités à 5 Mo. |
| En-têtes HTTP | `nosniff`, interdiction d'intégrer le site dans un autre (anti-clickjacking), politique de contenu (CSP), réponses de l'API jamais mises en cache, HTTPS imposé (HSTS) en production. |
| CORS | En production, aucun autre site ne peut appeler l'API (sauf adresses listées dans `CORS_ORIGIN`). |
| Abus | 300 requêtes par minute et par adresse au plus (`RATE_LIMIT_PER_MINUTE`). |
| Swagger | Désactivé en production (plan complet de l'API), sauf `SWAGGER=true`. |
| Journal d'audit | Lecture seule, protégé dans la base (ni modification ni suppression possible). |
| Base de production | Verrouillée : chargement de démo refusé, sauvegarde avant chaque migration (`docs/BASE_DE_DONNEES.md`). |
| Secrets | Mots de passe IJIN chiffrés (AES-GCM, `TCSAY_SECRET_KEY`). `JWT_SECRET` obligatoire et long en production. |

## Avant la mise en ligne (à faire par vous)
1. **Dépôt GitHub privé** : Settings › General › Danger Zone › Change visibility › Private.
2. **Mot de passe Gmail** publié par erreur dans l'historique : le révoquer (Google › Sécurité › Mots de passe des applications) et en créer un nouveau, seulement dans les variables de l'hébergeur.
3. Variables de production (dans l'hébergeur, **jamais dans Git**) :
   ```
   NODE_ENV=production
   TCSAY_PRODUCTION=true
   JWT_SECRET=<64 caractères aléatoires>
   TCSAY_SECRET_KEY=<64 caractères hexadécimaux>
   DATABASE_URL=<base de production>
   APP_URL=https://<votre-domaine>
   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM
   ```
   Générer une valeur : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. Ne jamais mettre `DEMO_MODE=true` ni `VITE_DEMO=1` en production.
5. Hébergeur derrière un proxy (Render le fait seul) : `TRUST_PROXY=true` pour que la limite d'essais voie la vraie adresse des visiteurs.

## Sauvegardes
- Manuelle : `npm run db:backup`
- Avec rotation (garde les 30 dernières) : `npm run db:backup -- --keep 30`
- Hors du PC automatiquement : `BACKUP_DIR` vers un dossier Google Drive / OneDrive synchronisé (dans `api/.env`), ex. `BACKUP_DIR=C:/Users/ADMIN/Google Drive/TCSAY-sauvegardes`.
- Chaque jour sous Windows (Planificateur de tâches › Créer une tâche de base › Quotidienne, 23h) :
  programme `cmd.exe`, arguments `/c cd /d C:\Users\ADMIN\TCSAY\TCSAY\api && npm run db:backup -- --keep 30`.
- En ligne : choisir une base avec sauvegarde quotidienne incluse (Render PostgreSQL payant, etc.) **et** garder la copie locale ci-dessus.
- Tester une restauration une fois par trimestre (`npm run db:restore` dans une base neuve).

## Règles d'usage
- Un compte par personne ; jamais de mot de passe partagé entre membres du bureau.
- Retirer les droits (Autorisations) d'un membre qui quitte le bureau, le jour même.
- Ne jamais envoyer le fichier des joueurs, une sauvegarde ou `api/.env` par messagerie ou sur GitHub.
- Après une mise à jour : `npm audit` dans `api/` et `web/` ; corriger les failles « high » et « critical ».
