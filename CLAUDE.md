# TCSAY : prompt de projet

Tu es mon assistant de développement pour **TCSAY (Tennis Club de Sayada, Tunisie)**. Réponds **en français**, de façon concise et directe. Exécute directement une fois la direction confirmée. Je travaille seul, dans VS Code, et je pousse sur GitHub.

## 0. Organisation du dépôt (état actuel)
- Monorepo unique `TCSAY` : `api/` (NestJS) et `web/` (React + Vite). `docker-compose.yml` à la racine pour l'infrastructure (PostgreSQL 16, Redis, Mailpit).
- Peut être scindé plus tard en `tcsay-api` / `tcsay-web` (`git subtree split`).
- **Ordre de développement choisi** : d'abord l'**admin web** (écran par écran, API + web ensemble), ensuite le **mobile**, enfin les **autres acteurs** (joueur, parent, coach). Les modules admin non livrés portent le badge « À venir » dans le menu.
- `docs/tcsay-prototype-v4.html` : prototype cliquable, **référence figée, ne jamais le modifier**. `docs/PROMPTS_SPRINTS.md` : prompts par sprint (rédigés pour deux dépôts ; ici, `tcsay-api` = `api/` et `tcsay-web` = `web/`). `docs/TCSAY_design_system.md` est **manquant** : en attendant, le prototype v4 fait foi.
- Données de démo : `cd api && npx prisma db seed` (les 4 saisons du prototype).

## 1. Le projet
Plateforme web et mobile qui remplace les cahiers papier et les paiements en espèces du club : réservation des terrains, cotisations par tranches, groupes d'entraînement, membres, coachs, salaires. L'historique du club est écrit à la main dans des cahiers depuis 2010 : il sera numérisé plus tard (OCR / vision par IA) avec validation humaine. Domaine souhaité : `tennisclubdesayada.tn` (à enregistrer au nom du club, disponibilité non vérifiée).

## 2. Acteurs et droits
| Acteur | Droits |
|---|---|
| **Joueur** | Voit ses paiements, séances, absences ; réserve un terrain (loisir) ; historique des tournois (module « À venir »). |
| **Parent** | Comme le joueur pour **plusieurs joueurs** : une liste de sélection du joueur en haut de chaque module. |
| **Coach** | Ses séances avec pointage des présences, ses salaires versés, réservation de terrain pour séances privées. **Ne voit jamais les cotisations des joueurs.** |
| **Administrateur** | Gère joueurs, parents, entraîneurs, groupes, terrains, catégories, saisons, tarifs, réservations, salaires, paiements, import historique, audit. |

- Les comptes joueur, parent et entraîneur sont **créés par l'admin** (pas d'inscription publique). Un email envoie l'identifiant et un **mot de passe temporaire** ; **changement obligatoire à la première connexion** (`mustChangePassword`).
- Seul l'admin attribue les rôles ; toujours au moins un admin actif.

## 3. Stack et organisation
- Branche par fonctionnalité (`feat/...`), pull request, tag à chaque sprint, commits Conventional Commits.
- **API** : NestJS (TypeScript) + Prisma **5** + PostgreSQL ; Swagger `/api/docs` ; préfixe `/api/v1` ; fuseau `Africa/Tunis` ; Docker (PostgreSQL 16, Redis, Mailpit SMTP 1025 / UI 8025) ; BullMQ + Redis pour l'import IA ; stockage compatible S3 (Cloudflare R2) pour les scans.
- **Web** : React (Vite) + TypeScript + Tailwind CSS v4 + React Router + TanStack Query + React Hook Form + zod.
- **Mobile** : Expo (React Native) + NativeWind (alternative : PWA).
- **Interdits** : aucune nouvelle bibliothèque sans me demander ; **aucune bibliothèque de composants UI** (MUI, shadcn, Ant, Chakra…) : composants écrits à la main.
- **Paiement en ligne** : **pas de Stripe**. Candidats : Konnect, ClicToPay, Paymee (à vérifier), ou espèces saisies par l'admin. Isoler le paiement derrière une interface pour changer de fournisseur.

## 4. Catégories (29), paires garçon / fille
- **Jeunes (20)** : (-6), (-7), (-8) Lutins / Lutines ; (-9), (-10) Poussins / Poussines ; (-11), (-12) Benjamins / Benjamines ; (-14) Minimes G. / F. ; (-16) Cadets / Cadettes ; (-18) Juniors G. / F.
- **Adultes (2)** : Seniors (probablement messieurs, à confirmer), Dames. **Vétérans (4)** : +35 (M), +35 (D), +45 (M), +45 (D). **Entreprise (2)** : Messieurs / Dames. **Padel (1)** : unique, probablement mixte (à confirmer).
- Une ligne par catégorie avec `gender` (M, F, MIXED) et `pairCode` (ex. `J7`). « Toutes » est un filtre, pas une catégorie.
- Un joueur est inscrit dans **une catégorie par saison**, proposée selon l'âge et le genre. Création d'un joueur : genre obligatoire ; âge minimum **4 ans (provisoire)** ; **mineur : parent obligatoire** ; **majeur : email obligatoire** ; catégorie hors norme : dérogation avec motif.

## 5. Saisons, tarifs, réservations
- Saisons : BROUILLON (DRAFT), ACTIVE, CLÔTURÉE (CLOSED), HISTORIQUE (HISTORICAL). L'admin peut créer des saisons passées avant l'import. Une seule ACTIVE ; une saison clôturée est verrouillée.
- **Tarifs d'entraînement** par catégorie et par groupe ; cotisation en **tranches**.
- **Réservation de terrain** : jour ou nuit (**nuit dès 18h** ; un terrain sans éclairage n'est pas réservable la nuit) ; type **loisir** (joueur, parent) ou **séance privée** (coach avec un élève) ; tarifs par type et par période, à l'heure.
- Annulation par joueur, parent ou coach refusée à **moins de 24 h** (paramétrable) ; l'admin peut forcer. **Pas de double réservation** : champ unique `activeKey = courtId|startTime`, mis à `null` à l'annulation.
- Salaires des coachs : saisis par l'admin (période, montant, Versé / À verser) ; le coach consulte ses salaires versés.
- Tous les montants des prototypes sont des **valeurs de démonstration** : n'invente aucun tarif.

## 6. Règles métier (côté API, jamais seulement côté interface)
- **R1** Saison clôturée ou historique verrouillée ; réouverture par l'admin avec motif.
- **R2** Une seule saison ACTIVE.
- **R3** Catégorie modifiable par l'admin seulement (âge, genre, dérogation avec motif) ; le joueur ou parent peut demander un changement.
- **R4** Ajout dans un groupe : capacité respectée, catégorie correspondante (dérogation avec motif).
- **R5** Groupe : pas de conflit de terrain, créneau ou entraîneur.
- **R6** Honoraires et salaires : modifiables sur saison en cours ou à venir ; sur saison clôturée, motif obligatoire, anciennes valeurs conservées.
- **R7** Un paiement encaissé n'est jamais modifié ni supprimé (remboursement ou écriture corrective) ; le montant dû ne change qu'avant le premier paiement ou avec motif.
- **R8** Suppression = **archivage** si l'élément a des liens.
- **R9** Joueur ou parent : téléphone, email, photo ; nom, naissance, genre, catégorie : admin seulement. Un mineur a au moins un parent lié.
- **R10** Annulation avec délai ; pas de modification d'un créneau passé.
- **R11** Un terrain avec réservations futures ne peut pas être désactivé.
- **R12** Seul l'admin attribue les rôles ; au moins un admin actif.
- **R13** Contrôle de version (champ `version`) contre l'écrasement entre deux admins.
- **R14** Les données importées gardent l'origine IMPORT et le lien vers la page scannée ; elles n'écrasent jamais une saisie manuelle sans validation.
- Toute modification sensible va dans un **journal d'audit** (qui, quand, avant, après, motif).
- **CRUD admin** : suppression = archivage partout ; cotisations C, R, U, pas de D ; paiements C (espèces) et R seulement ; audit en lecture seule ; comptes désactivés, jamais supprimés.

## 7. Modèle de données
Entités : User, Player, ParentLink, Coach, Season, Category, Enrollment, TrainingGroup, GroupMember, Court, Reservation, FeeSchedule, Membership, Installment, Payment, CoachFee, Attendance, Event, AuditLog, ImportBatch, ScannedPage, ExtractedRecord.
- User 1—0..1 Player ; User 1—0..1 Coach ; User 1—0..* ParentLink—1 Player (parents ↔ joueurs plusieurs-à-plusieurs).
- Player 1—0..* Enrollment (unique par joueur, saison, catégorie) ; Enrollment 1—0..1 Membership ; Membership 1—1..* Installment ; Installment 0..1—0..* Payment.
- Season/Category 1—0..* FeeSchedule (tarif unique par saison et catégorie).
- Season 1—0..* TrainingGroup ; Coach et Court 0..1—0..* TrainingGroup ; TrainingGroup 1—0..* GroupMember—1 Enrollment.
- Court 1—0..* Reservation ; Player et TrainingGroup 0..1—0..* Reservation.
- TrainingGroup 1—0..* Attendance (unique par groupe, joueur, date) ; Coach 1—0..* CoachFee ; Season 1—0..* CoachFee.
- Season 0..1—0..* ImportBatch—1..* ScannedPage—0..* ExtractedRecord ; AuditLog lié à User ; Event indépendant.

## 8. Conception de l'API
- **Fabrique de contrôleurs CRUD générique** pilotée par configuration par ressource : rôles autorisés (lecture, création, modification, archivage), champs modifiables par rôle, visibilité des lignes (admin : tout ; coach : ses groupes ; parent : ses enfants ; joueur : lui-même), filtres, fonction de validation portant R1 à R14.
- Contrôleurs dédiés : réservations (par date, mes réservations, création, annulation), cotisations (liste, création depuis le tarif, paiement d'une tranche, **403 pour le coach**), divers (suggestion de catégorie, statistiques admin, pointage, événements publics).
- Authentification JWT globale (`@Public`, `@Roles`), gardes de rôles, filtre d'erreurs Prisma (409 unicité, 404, 400), Swagger.

## 9. Design system (obligatoire)
La source de vérité est `docs/TCSAY_design_system.md` et le prototype `docs/tcsay-prototype-v4.html` (voir §13) : en cas de différence, c'est l'écran qui a tort. Résumé :
- **Principes** : clair, aéré, très arrondi, **sans ombres portées**, pas de dégradés sauf la grande carte d'accueil. Infos courtes = pastilles ; blocs = cartes à bordure 1,5px ; filtres = selects gris arrondis. Une seule police (**Montserrat** 400/500/600), une seule couleur d'action (indigo `#5a5acd`).
- **Jetons clairs / sombres** : `--bg` #fafafa / #121212 ; `--fg` #1a1a1a / #f2f2f2 ; `--mut` #8a8a8f / #9a9aa0 ; `--card` #fff / #1c1c1e ; `--line` #e6e6ea / #333 ; `--fld` #f3f4f8 / #26272b ; `--btn` #ebebeb / #2e2e32 ; `--pri` #5a5acd ; `--sel` #0000e0 ; `--dr` #f7f8fb / #17181b ; `--day` #f1f2f6 / #2a2b30 ; tranche payée #e9f7e1 / #1f2e1a ; à payer #ffe8e8 / #3a2224.
- **Pastilles** (texte toujours `#111`, rayon 99px, padding 5px 13px) : bleu `#c9e9fb` = date, heure, information ; vert `#dff3a8` = libre, confirmé, présent, payé, lieu ; rose `#fdb3b0` = pris, absent, à payer, erreur ; sable `#f0d9a8` = neutre, maintenance, brouillon, type, « À venir ».
- **Typographie** : base 15px ; h1 25–28px (23px mobile) 600 ; titre de section 17–19px 500 ; titre de carte 16px 500 ; sous-titre de carte 13px 600 gris ; libellé de formulaire 12px ; KPI 26–30px 600.
- **Rayons** : carte 24–28px ; select et champ 20–24px ; boutons et pastilles 99px ; bouton menu 14–15px ; note 18px ; modale 28px ; grande carte d'accueil 32–40px.
- **Composants** : bouton menu (carré 44–50px, 4 points en grille 2×2) ; menu latéral 262–270px (titre « MAIN », entrées en pilules rayon 18px, badge sable « À venir », carte utilisateur avec Déconnexion), en tiroir glissant avec voile sombre sous 860px ; accueil « Bienvenue Prénom 👋 », avatar 60×68px avec point vert, grande carte à dégradé (#14532d → #2f7a4d 60 % → #c2410c, 150°) avec bouton rond bleu en encoche, section « Événements » avec état vide ; cartes en grille `repeat(auto-fill, minmax(250px, 1fr))` (une colonne sur mobile) ; puces de 14 jours ; calendrier (Lun à Dim, jours en cercles, jour choisi `#0000e0`) avec bascule Mois / Semaine (capsule grise, option active `#222`) ; grille de réservation heures × terrains (libre = `--fld`, pris = rose, entretien / sans éclairage = sable, choisi = `--sel` texte blanc, ☀ terrain éclairé, ☾ heures dès 18h) ; cartes de tranche « Tranche 1/2 » avec « Montant payé / Montant restant » ; notes, modales, toasts (pilule `--fg`, 3 à 4 s).
- **Écrans** : liste = titre, sous-titre « Découvrez vos … », filtres, éventuel total, grille de cartes, note de règle ; réservation = sélecteur (parent ou coach), 14 jours, grille, récapitulatif avec prix, « Réserver », « Mes réservations » ; paiements = listes joueur et saison puis tranches ; séances = « À venir » puis « Passées » (coach : bouton Présences).
- **Adaptations validées (prioritaires sur le prototype)** :
  - **Logo officiel** du club (`web/public/logo-tcsay.png`, fond transparent, aussi en favicon) à la place de la balle « TC » : composant `Logo` / `Brand`.
  - **Menu latéral groupé par catégorie** (modèle validé par capture) : liens directs avec icône ; catégories repliables (icône + titre + chevron, fond `--fld` quand ouvertes) ; modules dessous avec puce et trait vertical (`--line`), module actif en gras avec puce `--pri` ; lien direct actif sur fond `--btn` avec petite barre à gauche ; seule la liste défile ; carte utilisateur en bas (avatar, NOM, email, bouton icône Déconnexion). Icônes SVG faites main (`components/ui/Icons.tsx`). Catégories admin : Dashboard · **Utilisateurs** (Joueurs, Parents, Entraîneurs) · **Entraînement** (Groupes, Catégories, Saisons) · **Terrains** (Terrains, Réservations, Tarifs terrains) · **Finances** (Paiements, Tarifs d’entraînement, Salaires) · **Suivi** (Emails envoyés, Journal d’audit, Import historique). Joueur / parent : Accueil · **Mon activité** (Mes séances, Mes absences) · Mes paiements · Réserver un terrain · Historique des tournois. Configuration : `web/src/layouts/menus.ts`.
- **Menus par rôle** : Joueur et Parent : Accueil, Mes paiements, Mes séances, Mes absences, Réserver un terrain, Historique des tournois (« À venir »). Coach : Mes séances, Mes salaires, Réserver (séances privées). Admin : Dashboard, Joueurs, Parents, Entraîneurs, Groupes, Terrains, Catégories, Saisons, Tarifs d'entraînement, Tarifs terrains, Réservations, Salaires, Paiements, Emails envoyés, Journal d'audit.
- **Comportements** : erreurs métier (R1–R14) en toast, jamais seulement en console ; confirmation avant archivage et annulation forcée ; catégorie proposée en direct dans le formulaire joueur.
- **Interdits** : bibliothèque UI, ombres, dégradés hors carte d'accueil, autre police, autres couleurs, tableaux HTML pour les listes (des cartes en grille). Interface 100 % française ; accessibilité : contrastes, focus visible, `aria-label` sur les boutons icônes, grille de réservation utilisable au clavier.

## 10. Planning (sprints de 2 semaines, départ le 5 octobre 2026)
S0 dépôts, Docker, Prisma, NestJS, Swagger, CRUD saisons · S1 authentification, rôles, audit, design system web · S2 saisons, catégories (29), terrains, coachs · S3 joueurs, parents, inscriptions, groupes · S4 réservations · S5 tarifs, cotisations, tranches, espèces · S6 paiement en ligne, reçus PDF, notifications (**MVP web**) · S7 coach : séances, présences, salaires · S8 dashboard, comptabilité, export · S9 import historique (pilote IA 30 à 50 pages) · S10–S11 mobile Expo · S12 tests, déploiement, formation du bureau (**lancement**). Après chaque sprint : démo à 1 ou 2 membres du bureau, rétrospective, mise à jour du cahier des charges, tag Git, déploiement de test.

## 11. Points à confirmer avec le bureau (ne pas inventer, poser une seule question)
Calcul de la catégorie (âge atteint ou année de naissance, date de référence) ; « Seniors » = messieurs ? Padel mixte ? ; âge minimum et compte propre d'un mineur ; tarifs réels (catégorie, groupe, tranches, réductions famille, terrains jour/nuit, début de la nuit) ; salaires des coachs (mensuel, horaire, forfait) ; délai d'annulation (24 h proposé) ; un parent peut-il réserver pour son enfant ? ; groupes mixtes ou séparés ; première année à numériser (2010 ?) ; passerelle de paiement et conformité aux règles tunisiennes de protection des données (scans avec données de mineurs).

## 12. Méthode de travail
- Une tâche à la fois. Fichiers **complets** avec leur chemin (pas d'extraits à fusionner).
- Applique R1 à R14 côté API. Aucun tarif inventé : les montants viennent de la base ou de données de démonstration clairement marquées.
- Si une information manque, pose **une seule question**.
- À la fin de chaque tâche : commandes pour lancer et tester (Swagger ou écran concerné) et message de commit.
- Si l'écran dérive du design, compare-le au prototype, liste les écarts, puis corrige.

## 13. Utiliser le prototype `docs/tcsay-prototype-v4.html`
- C'est une **maquette fonctionnelle en HTML/JS vanilla**, pas du code à copier. On le **reconstruit** en composants React + Tailwind v4 (web) et React Native + NativeWind (mobile), avec de vraies données de l'API.
- **À reprendre tel quel** : les jetons CSS (`:root` et blocs sombres, déjà copiés dans `web/src/index.css`), les tailles, rayons, pastilles, textes et libellés français, l'ordre des sections de chaque écran, les comportements (toasts, confirmations, catégorie proposée en direct, grille au clavier), la bascule « ☾ Sombre / ☀ Clair ».
- **À ne pas reprendre** : les données en dur (`PLAYERS`, `INST`, `RES`…), le routage maison, `innerHTML`, la date figée `NOW`, le bandeau « PROTOTYPE · MONTANTS DÉMO ». Les montants du prototype sont des valeurs de **démonstration**.
- Les règles R1–R14 sont simulées côté client dans le prototype ; dans le vrai code elles vivent **côté API** (messages au format « R2 · … »), l'interface affiche l'erreur renvoyée en toast.
- Pour lire un écran, cherche sa fonction dans le `<script>` : `vLogin`, `vChangePw`, `vHome`, `vPay`, `vSes`, `vAbs`, `vBook`, `vCSes`, `vCSal`, `vDash`, `vPlayers` (+ `playerForm`), `vParents`, `vCoaches`, `vGroups`, `vCourts`, `vCats`, `vSeasons`, `vFees`, `vCtar`, `vAres`, `vSal`, `vApay`, `vMails`, `vAudit`.
- Composants web déjà reconstruits (`web/src/components/ui`) : `Button` (.btn / .btn2 / danger), `IconButton` (.ico), `Pill` / `Pills` / `Badge`, `Card` (+ `CardRow`, `CardSubtitle`, `CardText`, `CardActions`, `Kpi`, `CardGrid`, `EmptyState`), `TextField` / `TextArea` / `SelectField` / `FilterSelect` / `Filters` / `FormGrid`, `Note`, `Modal`, `Toast`, `MenuButton`, `ThemeToggle`, `PageHeader`, `Logo` / `Brand`, `Icons`, `Avatar`, `Calendar`, `DayChips`, `Segmented`, `InstallmentCard`, `KeyValue`, `ConfirmModal`, `QueryState`, `Section` ; hors `ui/` : `BookingGrid`, `KidSelect`.

| Écran du prototype | Route web | Rôles | État |
|---|---|---|---|
| vLogin / vChangePw | `/connexion`, `/mot-de-passe` | tous | ✅ |
| vHome, vPay, vSes, vAbs, vBook | `/`, `/paiements`, `/seances`, `/absences`, `/reserver` | joueur, parent | ✅ |
| vCSes, vCSal, vBook | `/coach/seances`, `/coach/salaires`, `/coach/reserver` | coach | ✅ |
| vDash, vPlayers, vParents, vCoaches, vGroups, vCourts, vCats, vSeasons | `/admin`, `/admin/joueurs`, `/admin/parents`, `/admin/entraineurs`, `/admin/groupes`, `/admin/terrains`, `/admin/categories`, `/admin/saisons` | admin | ✅ |
| vFees, vCtar, vAres, vSal, vApay, vMails, vAudit | `/admin/tarifs`, `/admin/tarifs-terrains`, `/admin/reservations`, `/admin/salaires`, `/admin/paiements`, `/admin/emails`, `/admin/audit` | admin | ✅ |
| Profils (clic sur un nom), Personnel, Absences des entraîneurs | `/admin/joueurs/:id`, `/admin/parents/:id`, `/admin/entraineurs/:id`, `/admin/personnel(/:id)`, `/admin/absences` | admin | ✅ |
| Mes absences (coach) ; Planning, Historique des actions, Mes salaires (personnel) | `/coach/absences` ; `/staff/planning`, `/staff/historique`, `/staff/salaires` | coach ; STAFF | ✅ |
| Import historique, Historique des tournois | `/admin/import`, `/tournois` | admin / joueur | « À venir » |

- **Socle livré** (base, API, web) : chaque module se reprend ensuite écran par écran. Écarts connus : pas encore de fabrique CRUD générique (§8, contrôleurs dédiés à la place), paiement en ligne et reçus PDF (S6), import IA (S9), mobile (S10–S11).
- **Comptes de démo** (seed) : `admin@tcsay.tn` / `admin1234` ; `sana.benali@exemple.tn`, `omar.trabelsi@exemple.tn`, `iheb@exemple.tn` (coach), `agent@tcsay.tn` (personnel)… / `temporaire` ; connexion par email ou CIN (changement obligatoire). `npx prisma db seed` **vide puis recharge** la base.

- Quand tu construis un écran : ouvre sa fonction dans le prototype, liste les éléments visibles, construis-les, puis compare (captures prototype / application) et liste les écarts avant de conclure.
