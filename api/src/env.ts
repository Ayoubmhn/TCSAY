import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Charge api/.env sans dépendance externe, quel que soit le dossier de lancement (src/ ou dist/ → api/.env),
 * puis fixe le fuseau du club. Le chemin chargé est affiché au démarrage.
 */
const candidates = [resolve(__dirname, '..', '.env'), resolve(process.cwd(), '.env')];
export const ENV_FILE = candidates.find((f) => existsSync(f)) ?? null;
if (ENV_FILE) process.loadEnvFile(ENV_FILE);
process.env.TZ = process.env.TZ || 'Africa/Tunis';
