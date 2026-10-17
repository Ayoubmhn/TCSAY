// Base de production VIERGE : uniquement les données de référence du club, sans aucune donnée de démonstration.
//   npm run db:init-prod
// Contenu : paramètres, 29 catégories + Loisirs, saison 2026-2027 (active), terrains, entraîneurs du programme
// (prénom seulement, email provisoire), groupes et créneaux du programme réel, tarifs d'entraînement 2026-2027
// (Lutins 800 DT, autres 1000 DT), compte du président. Puis la base est marquée « production » : plus aucune
// commande de démonstration ne pourra l'effacer. Refuse de s'exécuter si la base contient déjà des comptes.
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { PrismaClient } from '@prisma/client';
import { databaseName, PRODUCTION_KEY } from './guard.mjs';
import { categories, COACHES, COURTS, DEFAULT_SETTINGS, feeFor, PROGRAMME } from './reference-data.mjs';

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}
const day = (d) => new Date(`${d}T00:00:00.000Z`);

async function ask(rl, question, fallback) {
  if (fallback) return fallback;
  let answer = '';
  while (!answer) answer = (await rl.question(question)).trim();
  return answer;
}

async function main() {
  try {
    await prisma.user.count();
  } catch {
    throw new Error('tables absentes : lancez d’abord npm run db:migrate.');
  }
  if ((await prisma.user.count()) > 0) {
    throw new Error(`la base « ${databaseName()} » contient déjà des comptes : l’initialisation ne se fait que sur une base vide.`);
  }

  console.log(`Initialisation de la base de production « ${databaseName()} ».\nCompte du président :`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const firstName = await ask(rl, '  Prénom : ', process.env.INIT_ADMIN_FIRSTNAME);
  const lastName = await ask(rl, '  Nom : ', process.env.INIT_ADMIN_LASTNAME);
  const email = (await ask(rl, '  Email (identifiant) : ', process.env.INIT_ADMIN_EMAIL)).toLowerCase();
  let password = process.env.INIT_ADMIN_PASSWORD ?? '';
  while (password.length < 8) password = (await rl.question('  Mot de passe (8 caractères au moins) : ')).trim();
  rl.close();

  await prisma.$transaction(
    async (tx) => {
      await tx.setting.createMany({ data: DEFAULT_SETTINGS });
      await tx.category.createMany({ data: categories() });
      const cat = Object.fromEntries((await tx.category.findMany()).map((c) => [c.code, c.id]));

      // Saison en cours : compétitif septembre → août (stage d'été inclus), loisirs octobre → juin.
      const season = await tx.season.create({
        data: {
          label: '2026-2027',
          startDate: day('2026-09-01'),
          endDate: day('2027-08-31'),
          leisureStartDate: day('2026-10-01'),
          leisureEndDate: day('2027-06-30'),
          status: 'ACTIVE',
        },
      });

      const T = {};
      for (const [i, [key, data]] of COURTS.entries()) T[key] = (await tx.court.create({ data: { ...data, sortOrder: i + 1 } })).id;

      // Entraîneurs : prénom du programme, email provisoire (aucun email n'y est envoyé), accès à créer par l'admin.
      const C = {};
      for (const [first, color] of COACHES) {
        const u = await tx.user.create({
          data: {
            email: `${first.toLowerCase()}@a-completer.invalid`,
            roles: ['COACH'],
            firstName: first,
            lastName: 'Exemple',
            passwordHash: hashPassword(randomBytes(24).toString('hex')),
          },
        });
        C[first] = (await tx.coach.create({ data: { userId: u.id, color } })).id;
      }

      for (const [name, slots] of Object.entries(PROGRAMME)) {
        const g = await tx.trainingGroup.create({ data: { seasonId: season.id, name, capacity: 12 } });
        for (const [d, start, end, court, coach] of slots) {
          await tx.groupSlot.create({
            data: {
              groupId: g.id,
              day: d,
              startTime: start,
              endTime: end,
              courtId: T[court],
              coaches: coach ? { create: [{ coachId: C[coach] }] } : undefined,
            },
          });
        }
      }

      for (const [code, id] of Object.entries(cat)) {
        await tx.feeSchedule.create({ data: { seasonId: season.id, categoryId: id, amount: feeFor(code), depositAmount: 0 } });
      }

      const president = await tx.user.create({
        data: { email, roles: ['PRESIDENT'], firstName, lastName, passwordHash: hashPassword(password), mustChangePassword: false },
      });
      await tx.setting.create({ data: { key: PRODUCTION_KEY, value: 'production' } });
      await tx.auditLog.create({
        data: {
          userId: president.id,
          action: 'Base de production initialisée',
          entity: 'Setting',
          target: databaseName(),
          after: `Saison 2026-2027, ${Object.keys(PROGRAMME).length} groupes, ${COACHES.length} entraîneurs`,
        },
      });
    },
    { timeout: 60_000 },
  );

  console.log('\n✔ Base de production prête :');
  console.log(`  - saison 2026-2027 active, ${Object.keys(PROGRAMME).length} groupes du programme, ${COURTS.length} terrains ;`);
  console.log(`  - ${COACHES.length} entraîneurs (prénom seulement, email provisoire à remplacer) ;`);
  console.log('  - tarifs d’entraînement 2026-2027 ; tarifs des terrains à saisir (écran Tarifs terrains) ;');
  console.log(`  - président : ${email}.`);
  console.log('  La base est marquée « production » : les commandes de démonstration la refuseront.');
  console.log('  Ajoutez TCSAY_PRODUCTION=true dans api/.env, puis lancez l’API.');
}

main()
  .catch((e) => {
    console.error(`\n⛔ Initialisation refusée : ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
