import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Charge api/.env sans dépendance externe, puis fixe le fuseau du club.
const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.TZ = process.env.TZ || 'Africa/Tunis';
