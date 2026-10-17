import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { geminiJson, geminiKey, geminiModel, geminiModels, type GeminiImage, type GeminiSchema } from './gemini';

/** Réglage du président : lecture par IA désactivée tant qu'il n'a pas accepté l'avertissement sur les données. */
const CONFIG_KEY = 'ai.import';
/** Compteur du mois (pages lues), pour suivre la limite gratuite. */
const USAGE_KEY = 'ai.usage';

export const AI_LIMITS = { photos: 6, photoBytes: 4 * 1024 * 1024 };

type AiConfig = { enabled: boolean; acceptedAt: string | null; acceptedBy: string | null };
type AiUsage = { month: string; pages: number; reads: number };
export type AiKind = 'players' | 'payments';

/** Case dont l'IA n'est pas sûre : colonne et raison (affichée à côté de la case). */
export type AiDoubt = { field: string; reason: string };

const PLAYER_FIELDS = ['n', 'gender', 'name', 'nameAr', 'birth', 'phone', 'email', 'parent', 'parentEmail', 'group', 'city', 'remark'] as const;
const PAYMENT_FIELDS = ['name', 'nameAr', 'amount', 'paid', 'method', 'receipt', 'date'] as const;
/** Longueurs maximales (celles des tableaux modifiables). */
const MAX: Record<string, number> = { n: 20, gender: 20, name: 120, nameAr: 120, birth: 30, phone: 80, email: 120, parent: 120, parentEmail: 200, group: 80, city: 80, remark: 300, amount: 20, paid: 20, method: 20, receipt: 20, date: 30 };

const doubtSchema: GeminiSchema = {
  type: 'ARRAY',
  description: 'Cases lues avec un doute (écriture illisible, chiffre ambigu, rature). Vide si tout est sûr.',
  items: { type: 'OBJECT', properties: { field: { type: 'STRING' }, reason: { type: 'STRING', description: 'Raison courte en français' } }, required: ['field', 'reason'] },
};
const tableSchema = (fields: readonly string[], desc: Record<string, string>): GeminiSchema => ({
  type: 'OBJECT',
  properties: {
    rows: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { ...Object.fromEntries(fields.map((f) => [f, { type: 'STRING', description: desc[f] } as GeminiSchema])), doubts: doubtSchema },
        required: [...fields, 'doubts'],
      },
    },
  },
  required: ['rows'],
});

const COMMON = `Tu lis la photo d'une page d'un cahier manuscrit du Tennis Club de Sayada (Tunisie), écrite en français et/ou en arabe.
Recopie chaque ligne du tableau de la page, dans l'ordre, sans en sauter ni en ajouter.
Règles strictes :
- N'invente jamais rien : une case vide ou illisible reste "" (chaîne vide) et tu ajoutes un doute pour cette colonne.
- Recopie les noms tels qu'ils sont écrits (ne corrige pas l'orthographe) ; le nom écrit en arabe va dans "nameAr" sans le traduire.
- Si un chiffre ou une lettre est ambigu, donne ta meilleure lecture et ajoute un doute avec la raison (ex. « 5 ou 6 ? »).
- Ligne barrée ou rayée : recopie ce qui est lisible et ajoute un doute « ligne barrée ».
- Ignore les titres, les totaux et les lignes vides.`;

const PROMPTS: Record<AiKind, { prompt: (groups: string[]) => string; schema: GeminiSchema }> = {
  players: {
    prompt: (groups) => `${COMMON}
Cette page est une liste de joueurs (inscriptions). Colonnes à remplir :
n (numéro de la ligne dans le cahier), gender ("h" garçon, "f" fille, "" si inconnu), name (nom et prénom en lettres latines), nameAr (nom en arabe),
birth (date de naissance au format AAAA-MM-JJ ; si seule l'année est écrite, l'année seule ; un jour/mois écrit 3/5 se lit jour 3, mois 5),
phone (téléphone tel qu'écrit), email, parent (nom du parent ou du tuteur), parentEmail, group (groupe d'entraînement), city (ville), remark (remarque).
Groupes existants du club (pour t'aider à lire, recopie quand même ce qui est écrit) : ${groups.join(', ') || 'aucun'}.`,
    schema: tableSchema(PLAYER_FIELDS, { gender: '"h", "f" ou ""', birth: 'AAAA-MM-JJ, AAAA ou ""' }),
  },
  payments: {
    prompt: () => `${COMMON}
Cette page est le cahier des paiements des cotisations. Colonnes à remplir :
name (nom du joueur en lettres latines), nameAr (nom en arabe), amount (montant dû, en dinars, chiffres seulement), paid (somme payée, chiffres seulement ;
« خالص » ou « payé » sans montant : écris "payé"), method ("Espèces" ou "Chèque", "" si non indiqué), receipt (numéro du reçu, chiffres seulement),
date (date du paiement au format AAAA-MM-JJ ; l'année manquante est celle de la saison en cours).`,
    schema: tableSchema(PAYMENT_FIELDS, { amount: 'chiffres seulement', paid: 'chiffres ou "payé"', receipt: 'chiffres seulement', date: 'AAAA-MM-JJ' }),
  },
};

/** Type réel de l'image d'après ses premiers octets (JPEG, PNG, WebP). */
function imageType(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const month = () => new Date().toISOString().slice(0, 7);

/**
 * Lecture des photos du cahier par Gemini (niveau gratuit) : la page devient un tableau à vérifier, jamais enregistré
 * directement. Les photos ne sont pas conservées par le club ; seul un compte rendu (qui, quand, combien de pages) est
 * inscrit dans l'historique des actions.
 */
@Injectable()
export class AiImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async read<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    try {
      return row ? { ...fallback, ...(JSON.parse(row.value) as T) } : fallback;
    } catch {
      return fallback;
    }
  }

  private write(key: string, value: unknown) {
    const v = JSON.stringify(value);
    return this.prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  }

  async status() {
    const cfg = await this.read<AiConfig>(CONFIG_KEY, { enabled: false, acceptedAt: null, acceptedBy: null });
    const usage = await this.read<AiUsage>(USAGE_KEY, { month: month(), pages: 0, reads: 0 });
    return {
      enabled: cfg.enabled,
      acceptedAt: cfg.acceptedAt,
      acceptedBy: cfg.acceptedBy,
      keyConfigured: Boolean(geminiKey()),
      provider: 'Gemini (Google), niveau gratuit',
      model: geminiModel(),
      limits: AI_LIMITS,
      usage: usage.month === month() ? usage : { month: month(), pages: 0, reads: 0 },
    };
  }

  /** Test de la clé (aucune photo envoyée) : modèles disponibles et présence du modèle choisi. */
  async test() {
    const models = await geminiModels();
    const model = geminiModel();
    const found = models.some((m) => m.name === model);
    return {
      ok: true,
      model,
      found,
      message: found
        ? `Clé acceptée par Google. Modèle « ${model} » disponible.`
        : `Clé acceptée par Google, mais le modèle « ${model} » n’est pas dans la liste : mettez par exemple GEMINI_MODEL=${models.find((m) => /flash/.test(m.name))?.name ?? models[0]?.name ?? '…'} dans api/.env.`,
      models: models.filter((m) => /flash/i.test(m.name)).slice(0, 12),
    };
  }

  /** Activation par le président : l'acceptation de l'avertissement est obligatoire et inscrite dans l'historique. */
  async configure(actor: AuthUser, enabled: boolean, accept: boolean) {
    const before = await this.status();
    if (enabled && !accept) throw new BadRequestException('Cochez la case : vous acceptez que les photos soient envoyées à Google (niveau gratuit de Gemini).');
    const who = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { firstName: true, lastName: true } });
    const name = who ? `${who.firstName} ${who.lastName}` : null;
    const cfg: AiConfig = enabled ? { enabled: true, acceptedAt: new Date().toISOString(), acceptedBy: name } : { enabled: false, acceptedAt: before.acceptedAt, acceptedBy: before.acceptedBy };
    await this.write(CONFIG_KEY, cfg);
    await this.audit.log(actor.id, {
      action: enabled ? 'Lecture des photos par IA activée' : 'Lecture des photos par IA désactivée',
      entity: 'Setting',
      target: 'Gemini (niveau gratuit)',
      before: before.enabled ? 'activée' : 'désactivée',
      after: enabled ? 'activée : photos envoyées à Google, données utilisables par Google (niveau gratuit), avertissement accepté' : 'désactivée',
    });
    return this.status();
  }

  /** Lit chaque photo (une requête par page) et renvoie les lignes, avec les cases douteuses et les pages en échec. */
  async readPages(actor: AuthUser, kind: AiKind, files: { buffer: Buffer; size: number }[]) {
    const st = await this.status();
    if (!st.enabled) throw new ForbiddenException('Lecture par IA désactivée : le président doit l’activer (avertissement sur les données à accepter).');
    if (!files.length) throw new BadRequestException('Ajoutez au moins une photo de la page du cahier.');
    if (files.length > AI_LIMITS.photos) throw new BadRequestException(`${AI_LIMITS.photos} photos au plus par lecture.`);
    const images: GeminiImage[] = files.map((f, i) => {
      const type = imageType(f.buffer);
      if (!type) throw new BadRequestException(`Photo ${i + 1} : format non reconnu (JPG, PNG ou WebP).`);
      return { mimeType: type, data: f.buffer };
    });

    const groups =
      kind === 'players'
        ? (await this.prisma.trainingGroup.findMany({ where: { season: { status: 'ACTIVE' }, archivedAt: null }, select: { name: true }, orderBy: { name: 'asc' } })).map((g) => g.name)
        : [];
    const fields: readonly string[] = kind === 'players' ? PLAYER_FIELDS : PAYMENT_FIELDS;
    const { prompt, schema } = PROMPTS[kind];

    const rows: Record<string, string>[] = [];
    const doubts: { row: number; field: string; reason: string }[] = [];
    const pages: { page: number; rows: number; doubts: number; error: string | null }[] = [];
    let read = 0;
    for (const [i, img] of images.entries()) {
      try {
        const { data } = await geminiJson<{ rows?: Record<string, unknown>[] }>(prompt(groups), [img], schema);
        const got = Array.isArray(data?.rows) ? data.rows : [];
        let d = 0;
        for (const r of got) {
          const clean = Object.fromEntries(fields.map((f) => [f, String(r?.[f] ?? '').trim().slice(0, MAX[f] ?? 120)]));
          if (!Object.values(clean).some(Boolean)) continue;
          const at = rows.length;
          rows.push(clean);
          for (const x of Array.isArray(r?.doubts) ? (r.doubts as AiDoubt[]) : []) {
            if (fields.includes(String(x?.field))) {
              doubts.push({ row: at, field: String(x.field), reason: String(x.reason ?? 'à vérifier').slice(0, 120) });
              d++;
            }
          }
        }
        pages.push({ page: i + 1, rows: got.length, doubts: d, error: null });
        read++;
      } catch (e) {
        // Limite gratuite atteinte : inutile d'essayer les pages suivantes.
        const msg = e instanceof Error ? e.message : String(e);
        pages.push({ page: i + 1, rows: 0, doubts: 0, error: msg });
        // Clé refusée ou limite atteinte : les pages suivantes échoueraient de la même façon.
        if (e instanceof HttpException && [429, 503].includes(e.getStatus())) {
          for (let k = i + 1; k < images.length; k++) pages.push({ page: k + 1, rows: 0, doubts: 0, error: 'non lue' });
          if (!rows.length) throw e;
          break;
        }
      }
    }

    const usage = st.usage;
    await this.write(USAGE_KEY, { month: usage.month, pages: usage.pages + read, reads: usage.reads + 1 });
    await this.audit.log(actor.id, {
      action: 'Photos du cahier lues par IA',
      entity: 'AiImport',
      target: kind === 'players' ? 'Joueurs' : 'Paiements du cahier',
      after: `${read}/${images.length} page(s) lue(s), ${rows.length} ligne(s), ${doubts.length} case(s) à vérifier · ${geminiModel()}`,
    });
    if (!rows.length) throw new BadRequestException(pages.find((p) => p.error)?.error ?? 'Aucune ligne lue sur ces photos : reprenez la photo bien à plat, nette et éclairée.');
    return { kind, rows, doubts, pages, model: geminiModel() };
  }
}
