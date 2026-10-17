# Base de données : règles et commandes

Objectif : **les données réelles du club ne changent jamais sans votre demande.**

## Deux bases séparées
| Base | Usage | Commande de chargement |
|---|---|---|
| `tcsay_demo` (ou `tcsay`) | essais, comptes de démonstration | `npm run db:demo` (vide puis recharge la démo) |
| `tcsay_prod` | **données réelles du club** | `npm run db:init-prod` une seule fois, sur une base vide |

La base utilisée est celle de `DATABASE_URL` dans `api/.env`. Au démarrage, l'API affiche :
`Base de données : tcsay_prod (PRODUCTION)`.

## Verrous (déjà en place)
1. `TCSAY_PRODUCTION=true` dans `api/.env` : les commandes de démonstration (seed, rechargement) refusent de s'exécuter.
2. La base de production est **marquée** « production » par `db:init-prod` : même sans la variable, le seed la refuse.
3. `npm run db:update` (et `db:migrate`) **ne charge plus jamais la démo** : il montre les changements de structure en attente, demande `OUI`, fait une **sauvegarde**, puis applique.
4. Le déploiement Render est manuel (`autoDeploy: false`) : un `git push` ne met rien en ligne.

## Mise en place de la base de production (une seule fois)
```bash
cd ~/TCSAY/TCSAY/api
# 1. Dans api/.env : DATABASE_URL=postgresql://tcsay:tcsay@localhost:5433/tcsay_prod?schema=public
#    (gardez l'ancienne ligne en commentaire pour revenir à la démo)
npm run db:migrate        # crée les tables (base neuve)
npm run db:init-prod      # demande prénom, nom, email et mot de passe du président
# 2. Ajouter TCSAY_PRODUCTION=true dans api/.env
npm run start:dev
```
`db:init-prod` crée : paramètres, catégories, saison 2026-2027 active, terrains, entraîneurs du programme
(prénom, nom « Exemple », email provisoire `@a-completer.invalid`), groupes et créneaux réels, tarifs
d'entraînement 2026-2027 (Lutins 800 DT, autres 1000 DT). **Aucun joueur, parent, paiement ou réservation.**
Les tarifs des terrains sont à saisir dans l'écran *Tarifs terrains*.

## Après chaque `git pull`
```bash
cd ~/TCSAY/TCSAY/api
npm install                # si de nouvelles dépendances
npm run db:status          # regarde seulement : y a-t-il des changements de structure ?
npm run db:migrate         # seulement si vous êtes d'accord : sauvegarde puis applique
npm run start:dev
```
Chaque changement de structure est annoncé dans le message de commit (ex. « ajoute une colonne vide »).
Une migration n'efface jamais de données : une nouvelle colonne est vide, ou reçoit une valeur par défaut.

## Sauvegardes
```bash
npm run db:backup                              # → api/backups/AAAA-MM-JJ_HHhMM_tcsay_prod_sauvegarde.json (+ .dump si pg_dump est installé)
npm run db:restore -- backups/<fichier>.json   # restaure dans une base NEUVE (après db:migrate)
```
- Une sauvegarde est faite automatiquement avant chaque `db:migrate`.
- **Copiez `api/backups/` hors du PC** (clé USB, Google Drive) au moins une fois par semaine.
- `api/backups/` n'est jamais envoyé sur GitHub (données personnelles, dont des mineurs).

## À ne jamais faire sur la base de production
- `npx prisma migrate reset` ou `npx prisma migrate dev` (peuvent effacer la base) ;
- `npx prisma db seed` / `npm run db:demo` (refusés par les verrous) ;
- `RESET_DEMO_DATA=true` (démo en ligne uniquement).
