import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmailKind, PaymentPlan, SeasonStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { CategoriesService } from '../categories/categories.service';
import { assertSeasonOpen, fullName, rule } from '../common/rules';
import { PaymentConfigService } from '../payments/payment-config.service';
import { PaymentsService } from '../payments/payments.service';
import { PLAN_LABEL } from '../payments/payment-plan';
import { PrismaService } from '../prisma/prisma.service';

class ListQuery {
  @IsUUID() seasonId: string;
}

class ItemDto {
  @IsUUID() playerId: string;
  /** Catégorie choisie ; absente = catégorie proposée (âge, genre). Hors catégorie proposée : motif obligatoire (R3). */
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() groupId?: string;
  @IsEnum(PaymentPlan, { message: 'Mode de paiement : comptant, par semestre ou par mois.' }) paymentPlan: PaymentPlan;
  @IsOptional() @IsString() @MaxLength(300) derogationReason?: string;
}

class ReenrollDto {
  @IsUUID() seasonId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ItemDto) items: ItemDto[];
}

/**
 * Réinscriptions pour une nouvelle saison : tous les joueurs (et leurs parents) de la saison précédente, puis les autres
 * joueurs actifs ; à l'affectation, catégorie (proposée selon l'âge), groupe facultatif et mode de paiement :
 * inscription, cotisation et tranches créées d'un coup, parents prévenus.
 */
@ApiTags('Saisons')
@ApiBearerAuth()
@Perm('players.manage')
@Controller('reenrollments')
export class ReenrollmentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    private readonly paymentConfig: PaymentConfigService,
  ) {}

  /** Modes proposés par le club (configuration des paiements). */
  private async plansOffered() {
    const cfg = await this.paymentConfig.get();
    return (Object.entries(PLAN_LABEL) as [PaymentPlan, string][]).filter(([value]) => cfg.plans[value]).map(([value, label]) => ({ value, label }));
  }

  private async target(seasonId: string) {
    const season = await this.prisma.season.findUnique({ where: { id: seasonId } });
    if (!season || season.archivedAt) throw new NotFoundException('Saison introuvable.');
    return season;
  }

  @Get()
  async list(@Query() q: ListQuery) {
    const season = await this.target(q.seasonId);
    const previous = await this.prisma.season.findFirst({
      where: { archivedAt: null, startDate: { lt: season.startDate } },
      orderBy: { startDate: 'desc' },
      select: { id: true, label: true },
    });
    const players = await this.prisma.player.findMany({
      where: { archivedAt: null },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        gender: true,
        memberCode: true,
        parentLinks: { where: { parent: { isActive: true } }, select: { parent: { select: { firstName: true, lastName: true } } } },
        enrollments: {
          where: { seasonId: { in: [season.id, previous?.id ?? season.id] } },
          select: {
            seasonId: true,
            category: { select: { id: true, name: true } },
            groups: { select: { group: { select: { name: true } } } },
            membership: { select: { paymentPlan: true } },
          },
        },
      },
    });
    const year = season.startDate.getUTCFullYear();
    const rows = [];
    for (const p of players) {
      const before = p.enrollments.find((e) => e.seasonId === previous?.id && previous?.id !== season.id);
      const now = p.enrollments.find((e) => e.seasonId === season.id);
      const s = p.birthDate ? await this.categories.suggest(p.birthDate, p.gender, year) : { error: 'naissance inconnue' };
      rows.push({
        id: p.id,
        name: fullName(p),
        code: p.memberCode,
        parents: p.parentLinks.map((l) => fullName(l.parent)),
        previous: before ? { category: before.category.name, groups: before.groups.map((g) => g.group.name), plan: before.membership?.paymentPlan ?? null } : null,
        enrolled: now ? { category: now.category.name, groups: now.groups.map((g) => g.group.name) } : null,
        suggested: 'category' in s && s.category ? { id: s.category.id, name: s.category.name, age: s.age } : null,
      });
    }
    const groups = await this.prisma.trainingGroup.findMany({
      where: { seasonId: season.id, archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, capacity: true, categoryId: true, _count: { select: { members: true } } },
    });
    const categories = await this.prisma.category.findMany({ where: { archivedAt: null }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } });
    return {
      season: { id: season.id, label: season.label, status: season.status },
      previous,
      players: rows,
      groups: groups.map((g) => ({ id: g.id, name: g.name, capacity: g.capacity, members: g._count.members, categoryId: g.categoryId })),
      categories,
      plans: await this.plansOffered(),
    };
  }

  @Post()
  async reenroll(@CurrentUser() actor: AuthUser, @Body() dto: ReenrollDto) {
    const season = await this.target(dto.seasonId);
    assertSeasonOpen(season);
    if (season.status !== SeasonStatus.DRAFT && season.status !== SeasonStatus.ACTIVE) {
      throw new BadRequestException('Réinscriptions : saison brouillon ou active seulement.');
    }
    const year = season.startDate.getUTCFullYear();
    const done: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    const noFee: string[] = [];
    for (const item of dto.items) {
      const player = await this.prisma.player.findUnique({
        where: { id: item.playerId },
        select: { id: true, firstName: true, lastName: true, birthDate: true, gender: true, archivedAt: true, parentLinks: { select: { parentId: true } }, userId: true },
      });
      if (!player || player.archivedAt) {
        skipped.push({ name: item.playerId, reason: 'joueur introuvable ou archivé' });
        continue;
      }
      const name = fullName(player);
      if (await this.prisma.enrollment.findUnique({ where: { playerId_seasonId: { playerId: player.id, seasonId: season.id } } })) {
        skipped.push({ name, reason: 'déjà inscrit pour cette saison' });
        continue;
      }
      const s = player.birthDate ? await this.categories.suggest(player.birthDate, player.gender, year) : { error: 'naissance inconnue' };
      const suggested = 'category' in s && s.category ? s.category.id : null;
      const categoryId = item.categoryId ?? suggested;
      if (!categoryId) {
        skipped.push({ name, reason: 'catégorie à choisir' });
        continue;
      }
      const derogation = item.derogationReason?.trim() || null;
      if (categoryId !== suggested && !derogation) {
        skipped.push({ name, reason: 'R3 · catégorie hors norme : motif obligatoire' });
        continue;
      }
      try {
        await this.prisma.$transaction(async (tx) => {
          const enrollment = await tx.enrollment.create({
            data: { playerId: player.id, seasonId: season.id, categoryId, derogationReason: categoryId !== suggested ? derogation : null },
            include: { category: true },
          });
          const groupIds: string[] = [];
          if (item.groupId) {
            const group = await tx.trainingGroup.findUnique({ where: { id: item.groupId }, include: { _count: { select: { members: true } } } });
            if (!group || group.archivedAt || group.seasonId !== season.id) throw new BadRequestException('Groupe introuvable pour cette saison.');
            if (group._count.members >= group.capacity) throw rule.conflict('R4', `Groupe ${group.name} complet (${group.capacity} places).`);
            await tx.groupMember.create({ data: { groupId: group.id, enrollmentId: enrollment.id } });
            groupIds.push(group.id);
          }
          await this.audit.log(
            actor.id,
            { action: 'Joueur réinscrit', entity: 'Enrollment', entityId: enrollment.id, target: `${name} · ${season.label}`, after: enrollment.category.name, reason: derogation ?? undefined },
            tx,
          );
          const membership = await this.payments.buildMembership(tx, actor.id, { ...enrollment, player }, season, item.paymentPlan, groupIds);
          if (!membership) noFee.push(name);
          const notify = [...player.parentLinks.map((l) => l.parentId), ...(player.userId ? [player.userId] : [])];
          if (notify.length) {
            await tx.notification.createMany({
              data: notify.map((userId) => ({
                userId,
                kind: EmailKind.OTHER,
                title: `${player.firstName} est réinscrit pour la saison ${season.label}`,
                body: `${name} : ${enrollment.category.name}, paiement ${PLAN_LABEL[item.paymentPlan].toLowerCase()}. L’échéancier est dans Mes paiements.`,
                link: '/paiements',
              })),
            });
          }
        });
        done.push(name);
      } catch (e) {
        skipped.push({ name, reason: e instanceof Error ? e.message : 'erreur' });
      }
    }
    return { enrolled: done.length, names: done, skipped, noFee };
  }
}
