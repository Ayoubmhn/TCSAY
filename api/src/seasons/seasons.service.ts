import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Season, SeasonStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeSeasonStatusDto } from './dto/change-season-status.dto';
import { CreateSeasonDto } from './dto/create-season.dto';
import { QuerySeasonsDto } from './dto/query-seasons.dto';
import { UpdateSeasonDto } from './dto/update-season.dto';

/** R1 : statuts verrouillés (aucune modification sans réouverture motivée). */
const LOCKED: readonly SeasonStatus[] = [SeasonStatus.CLOSED, SeasonStatus.HISTORICAL];

/** Transitions de statut autorisées. Sortir d'un statut verrouillé vers DRAFT ou ACTIVE = réouverture (motif). */
const TRANSITIONS: Record<SeasonStatus, readonly SeasonStatus[]> = {
  DRAFT: [SeasonStatus.ACTIVE, SeasonStatus.HISTORICAL],
  ACTIVE: [SeasonStatus.CLOSED],
  CLOSED: [SeasonStatus.ACTIVE, SeasonStatus.HISTORICAL],
  HISTORICAL: [SeasonStatus.DRAFT],
};

const STATUS_LABEL: Record<SeasonStatus, string> = {
  DRAFT: 'brouillon',
  ACTIVE: 'active',
  CLOSED: 'clôturée',
  HISTORICAL: 'historique',
};

/** Libellés pour le journal d'audit. */
const STATUS_NAME: Record<SeasonStatus, string> = {
  DRAFT: 'Brouillon',
  ACTIVE: 'Active',
  CLOSED: 'Clôturée',
  HISTORICAL: 'Historique',
};

const STATUS_ACTION: Record<SeasonStatus, string> = {
  DRAFT: 'Saison repassée en brouillon',
  ACTIVE: 'Saison activée',
  CLOSED: 'Saison clôturée',
  HISTORICAL: 'Saison passée en historique',
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class SeasonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll(query: QuerySeasonsDto): Promise<Season[]> {
    return this.prisma.season.findMany({
      where: {
        status: query.status,
        archivedAt: query.includeArchived ? undefined : null,
      },
      orderBy: { startDate: 'desc' },
    });
  }

  async findActive(): Promise<Season> {
    const season = await this.prisma.season.findFirst({
      where: { status: SeasonStatus.ACTIVE, archivedAt: null },
    });
    if (!season) throw new NotFoundException('Aucune saison active.');
    return season;
  }

  async findOne(id: string): Promise<Season> {
    const season = await this.prisma.season.findUnique({ where: { id } });
    if (!season) throw new NotFoundException('Saison introuvable.');
    return season;
  }

  async create(userId: string, dto: CreateSeasonDto): Promise<Season> {
    const startDate = toDate(dto.startDate);
    const endDate = toDate(dto.endDate);
    assertDateRange(startDate, endDate);
    const leisure = leisurePeriod(startDate, endDate, dto.leisureStartDate, dto.leisureEndDate);
    const season = await this.prisma.season.create({
      data: {
        label: dto.label.trim(),
        startDate,
        endDate,
        ...leisure,
        status: dto.status ?? SeasonStatus.DRAFT,
      },
    });
    await this.audit.log(userId, {
      action: 'Saison créée',
      entity: 'Season',
      entityId: season.id,
      target: season.label,
      after: STATUS_NAME[season.status],
    });
    return season;
  }

  async update(userId: string, id: string, dto: UpdateSeasonDto): Promise<Season> {
    const season = await this.findOne(id);
    assertNotArchived(season);
    if (LOCKED.includes(season.status)) {
      throw new ConflictException(
        `R1 · Saison ${STATUS_LABEL[season.status]} verrouillée : rouvrez-la avec un motif avant de la modifier.`,
      );
    }
    assertVersion(season, dto.version);

    const startDate = dto.startDate ? toDate(dto.startDate) : season.startDate;
    const endDate = dto.endDate ? toDate(dto.endDate) : season.endDate;
    assertDateRange(startDate, endDate);

    const leisure = leisurePeriod(
      startDate,
      endDate,
      dto.leisureStartDate ?? (season.leisureStartDate ? iso(season.leisureStartDate) : undefined),
      dto.leisureEndDate ?? (season.leisureEndDate ? iso(season.leisureEndDate) : undefined),
    );
    const updated = await this.writeWithVersion(id, dto.version, {
      label: dto.label?.trim(),
      startDate,
      endDate,
      ...leisure,
    });
    await this.audit.log(userId, {
      action: 'Saison modifiée',
      entity: 'Season',
      entityId: id,
      target: updated.label,
      before: `${season.label} · ${iso(season.startDate)} → ${iso(season.endDate)}`,
      after: `${updated.label} · ${iso(updated.startDate)} → ${iso(updated.endDate)}`,
    });
    return updated;
  }

  async changeStatus(userId: string, id: string, dto: ChangeSeasonStatusDto): Promise<Season> {
    return this.prisma.$transaction(
      async (tx) => {
        const season = await tx.season.findUnique({ where: { id } });
        if (!season) throw new NotFoundException('Saison introuvable.');
        assertNotArchived(season);
        assertVersion(season, dto.version);

        const from = season.status;
        const to = dto.status;
        if (from === to) {
          throw new BadRequestException(`La saison est déjà ${STATUS_LABEL[to]}.`);
        }
        if (!TRANSITIONS[from].includes(to)) {
          throw new BadRequestException(
            `Passage de « ${STATUS_LABEL[from]} » à « ${STATUS_LABEL[to]} » non autorisé.`,
          );
        }

        const reopening = LOCKED.includes(from) && !LOCKED.includes(to);
        if (reopening && !dto.reason?.trim()) {
          throw new BadRequestException(
            'R1 · Le motif est obligatoire pour rouvrir une saison clôturée ou historique.',
          );
        }

        if (to === SeasonStatus.ACTIVE) {
          const active = await tx.season.findFirst({
            where: { status: SeasonStatus.ACTIVE, archivedAt: null, NOT: { id } },
          });
          if (active) {
            throw new ConflictException(
              `R2 · Une seule saison active : clôturez d’abord la saison ${active.label}.`,
            );
          }
        }

        const updated = await tx.season.update({
          where: { id },
          data: { status: to, version: { increment: 1 } },
        });

        await this.audit.log(
          userId,
          {
            action: reopening ? 'Saison rouverte' : STATUS_ACTION[to],
            entity: 'Season',
            entityId: id,
            target: season.label,
            before: STATUS_NAME[from],
            after: STATUS_NAME[to],
            reason: dto.reason,
          },
          tx,
        );
        return updated;
      },
      // Sérialisable : deux activations simultanées ne peuvent pas passer toutes les deux (R2).
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** R8 : suppression = archivage. Une saison active ne peut pas être archivée. */
  async archive(userId: string, id: string, version: number): Promise<Season> {
    const season = await this.findOne(id);
    assertNotArchived(season);
    assertVersion(season, version);
    if (season.status === SeasonStatus.ACTIVE) {
      throw new ConflictException('R8 · Impossible d’archiver la saison active : clôturez-la d’abord.');
    }
    const archived = await this.writeWithVersion(id, version, { archivedAt: new Date() });
    await this.audit.log(userId, {
      action: 'Saison archivée',
      entity: 'Season',
      entityId: id,
      target: season.label,
      before: STATUS_NAME[season.status],
      after: 'Archivée',
    });
    return archived;
  }

  /** R13 : écriture conditionnée à la version lue ; incrémente la version. */
  private async writeWithVersion(
    id: string,
    version: number,
    data: Prisma.SeasonUpdateManyMutationInput,
  ): Promise<Season> {
    const { count } = await this.prisma.season.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    if (count === 0) throw versionConflict();
    return this.findOne(id);
  }
}

function toDate(value: string): Date {
  // Date seule (colonne @db.Date) : on fixe minuit UTC pour éviter tout décalage de jour.
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

/**
 * Période loisirs : par défaut du 1er octobre au 30 juin de la saison, bornée par la saison
 * (le compétitif va du début à la fin de saison, août et stage d'été inclus).
 */
function leisurePeriod(start: Date, end: Date, from?: string, to?: string): { leisureStartDate: Date; leisureEndDate: Date } {
  const y = start.getUTCFullYear();
  const defStart = new Date(Date.UTC(start.getUTCMonth() > 9 ? y + 1 : y, 9, 1));
  const leisureStartDate = from ? toDate(from) : defStart < start ? start : defStart;
  const defEnd = new Date(Date.UTC(leisureStartDate.getUTCFullYear() + 1, 5, 30));
  const leisureEndDate = to ? toDate(to) : defEnd > end ? end : defEnd;
  if (leisureStartDate < start || leisureEndDate > end || leisureEndDate <= leisureStartDate) {
    throw new BadRequestException('La période loisirs doit être comprise dans la saison (par défaut octobre → juin).');
  }
  return { leisureStartDate, leisureEndDate };
}

function assertDateRange(start: Date, end: Date): void {
  if (end <= start) {
    throw new BadRequestException('La date de fin doit être postérieure à la date de début.');
  }
}

function assertNotArchived(season: Season): void {
  if (season.archivedAt) throw new ConflictException('Saison archivée : aucune modification possible.');
}

function assertVersion(season: Season, version: number): void {
  if (season.version !== version) throw versionConflict();
}

function versionConflict(): ConflictException {
  return new ConflictException(
    'R13 · Cette saison a été modifiée par un autre administrateur : rechargez-la puis recommencez.',
  );
}
