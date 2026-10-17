import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ComplaintCategory, ComplaintKind, ComplaintStatus, EmailKind, Prisma, Role } from '@prisma/client';
import { AuthUser, can } from '../auth/auth-user';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';

/** Responsable de chaque catégorie (autorisation) ; « complaints.manage » voit tout, sauf le comportement. */
export const CATEGORY_PERMS: Record<ComplaintCategory, string[]> = {
  PAYMENT: ['payments.collect'],
  RESERVATION: ['reservations.manage'],
  TRAINING: ['evaluations.manage', 'groups.manage'],
  FACILITIES: ['courts.manage'],
  APP: [],
  BEHAVIOR: [],
  OTHER: [],
};

export const CATEGORY_LABEL: Record<ComplaintCategory, string> = {
  PAYMENT: 'Paiement, reçu',
  RESERVATION: 'Réservation, terrain',
  TRAINING: 'Entraînement',
  FACILITIES: 'Installations, matériel',
  APP: 'Application',
  BEHAVIOR: 'Comportement',
  OTHER: 'Autre',
};

export const KIND_LABEL: Record<ComplaintKind, string> = { COMPLAINT: 'Réclamation', SUGGESTION: 'Suggestion', URGENT: 'Signalement urgent' };

/** Délai de réponse visé : sans activité de la direction, rappel aux responsables. */
export const ANSWER_HOURS = 72;
const EVERY_MS = 60 * 60_000;

/**
 * Réclamations : qui les traite (selon la catégorie), qui les voit, notifications et rappel après 72 h sans réponse.
 * Règles : la personne visée ne voit jamais la réclamation ; « Comportement » et signalements urgents vont au président.
 */
@Injectable()
export class ComplaintsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Réclamations');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.remind().catch((e) => this.logger.warn(String(e))), EVERY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  isPresident(user: AuthUser) {
    return user.roles.includes(Role.PRESIDENT);
  }

  /** Réclamations que l'utilisateur traite (espace administration), ou null s'il n'en traite aucune. */
  scope(user: AuthUser): Prisma.ComplaintWhereInput | null {
    if (user.role !== Role.ADMIN) return null;
    const notTarget: Prisma.ComplaintWhereInput = { OR: [{ targetUserId: null }, { targetUserId: { not: user.id } }] };
    if (this.isPresident(user)) return notTarget;
    const cats = (Object.keys(CATEGORY_PERMS) as ComplaintCategory[]).filter((c) => c !== ComplaintCategory.BEHAVIOR && (can(user, 'complaints.manage') || CATEGORY_PERMS[c].some((p) => can(user, p))));
    if (!cats.length) return null;
    return { AND: [notTarget, { category: { in: cats } }] };
  }

  /** Comptes à prévenir pour une réclamation (responsables de la catégorie, président si urgent ou comportement). */
  async handlers(c: { category: ComplaintCategory; kind: ComplaintKind; targetUserId: string | null; authorId: string }): Promise<string[]> {
    const presidents = (await this.prisma.user.findMany({ where: { isActive: true, roles: { has: Role.PRESIDENT } }, select: { id: true } })).map((u) => u.id);
    let ids: string[] = [];
    if (c.category === ComplaintCategory.BEHAVIOR) ids = presidents;
    else {
      const lists = await Promise.all([...CATEGORY_PERMS[c.category], 'complaints.manage'].map((p) => this.permissions.holders(p)));
      ids = [...lists.flat(), ...(c.kind === ComplaintKind.URGENT ? presidents : [])];
      if (!ids.length) ids = presidents;
    }
    return [...new Set(ids)].filter((id) => id !== c.targetUserId && id !== c.authorId);
  }

  async notify(users: string[], title: string, body: string, link: string) {
    if (users.length) await this.prisma.notification.createMany({ data: users.map((userId) => ({ userId, kind: EmailKind.OTHER, title, body, link })) });
  }

  /** Rappel : réclamation ouverte sans activité depuis 72 h (une fois tous les 72 h). */
  async remind() {
    const limit = new Date(Date.now() - ANSWER_HOURS * 3_600_000);
    const late = await this.prisma.complaint.findMany({
      where: { status: { in: [ComplaintStatus.NEW, ComplaintStatus.IN_PROGRESS] }, lastActivityAt: { lt: limit }, OR: [{ remindedAt: null }, { remindedAt: { lt: limit } }] },
      take: 50,
    });
    for (const c of late) {
      const to = c.assigneeId ? [c.assigneeId] : await this.handlers(c);
      await this.notify(to, `Réclamation n° ${c.number} sans réponse`, `« ${c.subject} » attend une réponse depuis plus de ${ANSWER_HOURS} h.`, `/admin/reclamations/${c.id}`);
      await this.prisma.complaint.update({ where: { id: c.id }, data: { remindedAt: new Date() } });
    }
    if (late.length) this.logger.log(`${late.length} rappel(s) envoyé(s).`);
  }
}
