// Outils des tests de paiement (joueur de test, tranches, n° de reçu libre). Séparés de helpers.mjs.
import { login, ok, uid } from './helpers.mjs';

/**
 * Joueur de test créé pour le scénario (tarif de la démo : 1000 DT). Adulte : email et CIN uniques.
 * Mineur : parent créé avec un email provisoire (aucun envoi) ; le mot de passe temporaire du parent est renvoyé
 * par l'API, ce qui permet de se connecter en parent avec sa CIN (`parent()`).
 */
export async function newPlayer(admin, { minor = false, plan = 'SEMESTER', gender = 'M' } = {}) {
  const id = uid();
  const cin = ('E' + id).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12).padEnd(8, '0');
  const body = minor
    ? {
        firstName: 'Enfant',
        lastName: `Test ${id}`,
        birthDate: '2014-05-10',
        gender,
        paymentPlan: plan,
        newParent: { firstName: 'Parent', lastName: `Test ${id}`, phone: '20000000', email: `parent.${id}@a-completer.invalid`, cin },
      }
    : { firstName: 'Adulte', lastName: `Test ${id}`, birthDate: '1995-03-10', gender, phone: '20000000', email: `adulte.${id}@exemple.tn`, cin, paymentPlan: plan };
  const player = ok(await admin('POST', '/players', body), 'création du joueur de test');
  const cred = player.temporaryPasswords?.[0];
  return { player, parent: cred ? () => login(cred.login, cred.temporaryPassword, 'parent') : null };
}

/** Tranches d'un joueur (saison active), triées par numéro. */
export async function installmentsOf(admin, playerId) {
  const r = ok(await admin('GET', `/installments?playerId=${playerId}`), 'tranches du joueur');
  return r.sort((a, b) => a.number - b.number);
}

/** N° de reçu jamais utilisé (le carnet ne réutilise jamais un numéro). */
export const freeReceiptNumber = () => 10_000_000 + Math.floor(Math.random() * 89_000_000);

/**
 * « Accès après paiement » ne doit pas dépendre du jour où les tests tournent (une tranche de démo finit toujours par
 * être échue) : exception posée pendant le scénario sur les joueurs qui n'en avaient pas. Renvoie la remise en état.
 */
export async function openAccess(admin, parent, players) {
  const added = [];
  for (const p of players) {
    const s = ok(await parent('GET', `/access/payment/status?playerId=${p.id}`), 'état de l’accès');
    if (s.exempt) continue;
    ok(await admin('PUT', '/access/payment/exemption', { playerId: p.id, reason: 'Tests E2E : accès indépendant de la date' }), 'exception d’accès');
    added.push(p.id);
  }
  return async () => {
    for (const id of added) ok(await admin('PUT', '/access/payment/exemption', { playerId: id }), 'retrait de l’exception');
  };
}
