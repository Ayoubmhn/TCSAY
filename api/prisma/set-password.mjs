// Mot de passe perdu (ex. président de la base du club) : pose un nouveau mot de passe sur un compte.
//   npm run db:set-password
// Agit sur la base de DATABASE_URL (api/.env, ou `export DATABASE_URL=…` dans le terminal). Le compte est réactivé,
// sans changement obligatoire ; ses autres sessions sont fermées (l'empreinte du mot de passe change). Trace dans
// l'historique des actions. Ne modifie rien d'autre.
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { PrismaClient } from '@prisma/client';
import { databaseName } from './guard.mjs';

const prisma = new PrismaClient();
const ADMIN_ROLES = ['PRESIDENT', 'ADMIN_AGENT', 'SUPERVISOR', 'TECH_DIRECTOR', 'ADMIN'];

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

async function main() {
  console.log(`Base : « ${databaseName()} »\n`);
  const admins = await prisma.user.findMany({
    where: { roles: { hasSome: ADMIN_ROLES } },
    select: { email: true, cin: true, firstName: true, lastName: true, roles: true, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log('Comptes de l’administration :');
  for (const a of admins) console.log(`  ${a.email ?? a.cin} · ${a.firstName} ${a.lastName} · ${a.roles.join(', ')}${a.isActive ? '' : ' (désactivé)'}`);

  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question) => {
    process.stdout.write(question);
    const { value, done } = await lines.next();
    if (done) throw new Error('saisie interrompue : rien n’a été modifié.');
    return value.trim();
  };
  const login = (await ask('\nEmail ou CIN du compte : ')).toLowerCase();
  const user = await prisma.user.findFirst({ where: { OR: [{ email: login }, { cin: login }] } });
  if (!user) {
    rl.close();
    throw new Error(`aucun compte « ${login} » dans cette base.`);
  }
  let password = '';
  for (;;) {
    password = await ask('Nouveau mot de passe (10 caractères, lettres et chiffres) : ');
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      console.log('  Au moins 10 caractères, avec au moins une lettre et un chiffre.');
      continue;
    }
    if ((await ask('Retapez-le : ')) === password) break;
    console.log('  Les deux mots de passe ne sont pas identiques.');
  }
  const answer = await ask(`Remplacer le mot de passe de ${user.firstName} ${user.lastName} dans « ${databaseName()} » ? Tapez OUI : `);
  rl.close();
  if (answer.toUpperCase() !== 'OUI') {
    console.log('Annulé : rien n’a été modifié.');
    return;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(password), mustChangePassword: false, temporaryPassword: false, isActive: true, version: { increment: 1 } },
  });
  await prisma.auditLog.create({
    data: { userId: user.id, action: 'Mot de passe remplacé (commande db:set-password)', entity: 'User', entityId: user.id, target: `${user.firstName} ${user.lastName}` },
  });
  console.log(`✔ Mot de passe remplacé. Connexion avec « ${user.email ?? user.cin} ».`);
  console.log('  Trop d’essais ratés juste avant ? Attendez 15 minutes, ou redémarrez le serveur.');
}

main()
  .catch((e) => {
    console.error(`✖ ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
