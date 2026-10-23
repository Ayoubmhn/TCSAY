import { CanActivate, ExecutionContext, Injectable, Logger, NotFoundException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Modules activables : une même application, plusieurs mises en ligne (version complète, version du club).
 * Chaque mise en ligne coupe des modules dans MODULES_COUPES (api/.env ou Render), ex. :
 *   MODULES_COUPES=budget,disponibilites,import-historique
 * Un module coupé disparaît du site (menu, écrans, accueil, préchargement) et ses routes répondent 404.
 * Ses données restent en base : le rallumer (retirer sa clé, redémarrer) suffit, sans migration.
 * Réglé à l'installation, jamais depuis l'application : le président ne peut pas rallumer un module.
 */
export const MODULES = {
  arabe: 'Langue arabe',
  budget: 'Projets et budget (devis, budget de saison, trésorerie)',
  disponibilites: 'Disponibilités et assistant de créneau',
  'import-historique': 'Import historique des saisons passées',
  'evaluation-seances': 'Évaluation des séances, suivi et progression',
  bilans: 'Bilans des joueurs, niveau et suivi technique',
  exercices: 'Exercices à la maison',
} as const;

export type ModuleKey = keyof typeof MODULES;

const KEYS = Object.keys(MODULES) as ModuleKey[];
const logger = new Logger('Modules');

/** Modules coupés pour cette mise en ligne (clés inconnues signalées au démarrage, puis ignorées). */
export function disabledModules(): ModuleKey[] {
  const raw = (process.env.MODULES_COUPES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return KEYS.filter((k) => raw.includes(k));
}

export function unknownModules(): string[] {
  return (process.env.MODULES_COUPES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && !KEYS.includes(s as ModuleKey));
}

export const moduleEnabled = (key: ModuleKey) => !disabledModules().includes(key);

/** Au démarrage : modules coupés et clés mal écrites (une faute de frappe laisserait le module allumé). */
export function logModules() {
  const off = disabledModules();
  if (off.length) logger.log(`Modules coupés : ${off.join(', ')}`);
  const bad = unknownModules();
  if (bad.length) logger.warn(`MODULES_COUPES : clés inconnues ignorées (${bad.join(', ')}). Clés possibles : ${KEYS.join(', ')}`);
}

export const FEATURE = 'feature';

/**
 * Contrôleur (ou route) d'un module activable. Plusieurs clés : la route reste ouverte si l'un de ces modules
 * est allumé (ex. le suivi d'un joueur sert à l'évaluation des séances comme aux bilans).
 */
export const Feature = (...keys: ModuleKey[]) => SetMetadata(FEATURE, keys);

/** Garde globale : route d'un module coupé = 404 (avant même la connexion). */
@Injectable()
export class ModulesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const keys = this.reflector.getAllAndOverride<ModuleKey[] | undefined>(FEATURE, [ctx.getHandler(), ctx.getClass()]);
    if (!keys?.length) return true;
    if (keys.some(moduleEnabled)) return true;
    throw new NotFoundException('Ce module n’est pas disponible.');
  }
}
