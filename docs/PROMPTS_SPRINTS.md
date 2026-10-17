# TCSAY : prompts à coller dans Claude Code

Lance `claude` depuis le dossier `tcsay/`. Colle **un prompt à la fois** et valide le résultat avant le suivant.
Astuce : commence chaque tâche importante par le mode plan (Maj+Tab deux fois) pour relire le plan avant que Claude Code écrive les fichiers.

---

## Prompt 0 : vérification (à coller en premier)

```
Lis CLAUDE.md, puis docs/TCSAY_design_system.md et le <script> de docs/tcsay-prototype-v4.html.
Ne code rien. Réponds en 10 lignes maximum :
1. ce que tu as compris du projet et des 4 rôles ;
2. les écarts éventuels entre le design system et le prototype ;
3. la liste des outils à installer sur ma machine pour le sprint S0 (Node, pnpm, Docker…), avec les versions.
```

---

## Prompt S0-a : dépôt API

```
Sprint S0, dépôt tcsay-api (à créer dans tcsay/tcsay-api).
Objectif : un squelette NestJS qui démarre, avec Docker, Prisma 5 et Swagger.
1. git init, branche par défaut dev, .gitignore, .editorconfig, README court en français.
2. NestJS (TypeScript strict), préfixe global /api/v1, Swagger sur /api/docs, ValidationPipe global (whitelist, transform), fuseau Africa/Tunis.
3. docker-compose.yml : PostgreSQL 16, Redis, Mailpit (SMTP 1025, UI 8025). Fichier .env.example.
4. Prisma 5 : schéma initial avec uniquement Season (id, name unique, status DRAFT|ACTIVE|CLOSED|HISTORICAL, startDate, endDate, version, createdAt, updatedAt, archivedAt) et AuditLog. Première migration + seed (les 4 saisons du prototype).
5. Module seasons : CRUD complet avec R1 (saison CLOSED/HISTORICAL verrouillée), R2 (une seule ACTIVE), R8 (archivage au lieu de suppression), R13 (champ version), et écriture dans AuditLog.
6. Filtre d'erreurs Prisma (409, 404, 400) avec messages en français.
7. Tests e2e minimaux sur R1 et R2.
Fichiers complets avec leur chemin. Termine par : commandes pour lancer et tester dans Swagger, et le message de commit.
```

## Prompt S0-b : dépôt web

```
Sprint S0, dépôt tcsay-web (à créer dans tcsay/tcsay-web).
Objectif : un squelette React qui affiche le shell du prototype, sans données réelles.
1. git init (branche main), Vite + React + TypeScript strict, Tailwind CSS v4, React Router, TanStack Query, React Hook Form, zod. Aucune autre bibliothèque.
2. Feuille de base : reprends EXACTEMENT les jetons CSS du prototype (bloc :root, blocs sombres, Montserrat) dans src/styles/tokens.css et expose-les à Tailwind v4 via @theme.
3. Composants écrits à la main dans src/ui : Pill (b, g, r, s), Button (primaire, secondaire, danger), Card, Select, Field, Note, Modal, Toast (file + hook useToast), MenuButton (4 points), Sidebar en tiroir sous 860px.
4. Layout AppShell identique au prototype (menu « MAIN », carte utilisateur, bascule clair/sombre) avec les menus des 4 rôles et des pages vides « À construire ».
5. Une page /design qui affiche tous les composants, pour comparer avec le prototype.
Compare ensuite /design et le shell avec docs/tcsay-prototype-v4.html, liste les écarts et corrige-les.
Termine par : commandes pour lancer, écran à ouvrir, message de commit.
```

---

## Prompt S1 : authentification (après la démo S0)

```
Sprint S1. Dans tcsay-api : modèle User (rôles ADMIN, COACH, PARENT, PLAYER, mustChangePassword, isActive), auth JWT globale avec @Public et @Roles, POST /auth/login, POST /auth/change-password, GET /auth/me, R12 (au moins un admin actif), envoi des identifiants par email via Mailpit, audit des connexions sensibles.
Dans tcsay-web : écrans vLogin et vChangePw du prototype, redirection forcée vers /mot-de-passe tant que mustChangePassword = true, menus selon le rôle.
Commence par le plan, attends ma validation, puis code.
```

## Modèle pour les sprints suivants

```
Sprint SX : <module>. Écrans du prototype concernés : <vXxx, vYyy>.
API : <ressources, règles R…>. Web : reconstruis ces écrans à l'identique du prototype avec les vraies données.
Commence par le plan, attends ma validation, puis code. À la fin : écarts avec le prototype, commandes de test, message de commit.
```
