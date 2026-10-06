import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Season, SeasonStatus } from '@prisma/client';
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

@Injectable()
export class SeasonsService {
  private readonly logger = new Logger(SeasonsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  create(dto: CreateSeasonDto): Promise<Season> {
    const startDate = toDate(dto.startDate);
    const endDate = toDate(dto.endDate);
    assertDateRange(startDate, endDate);
    return this.prisma.season.create({
      data: {
        label: dto.label.trim(),
        startDate,
        endDate,
        status: dto.status ?? SeasonStatus.DRAFT,
      },
    });
  }

  async update(id: string, dto: UpdateSeasonDto): Promise<Season> {
    const season = await this.findOne(id);
    assertNotArchived(season);
    if (LOCKED.includes(season.status)) {
      throw new ConflictException(
        `Saison ${STATUS_LABEL[season.status]} verrouillée : rouvrez-la avec un motif avant de la modifier (R1).`,
      );
    }
    assertVersion(season, dto.version);

    const startDate = dto.startDate ? toDate(dto.startDate) : season.startDate;
    const endDate = dto.endDate ? toDate(dto.endDate) : season.endDate;
    assertDateRange(startDate, endDate);

    return this.writeWithVersion(id, dto.version, {
      label: dto.label?.trim(),
      startDate,
      endDate,
    });
  }

  async changeStatus(id: string, dto: ChangeSeasonStatusDto): Promise<Season> {
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
            'Un motif est obligatoire pour rouvrir une saison clôturée ou historique (R1).',
          );
        }

        if (to === SeasonStatus.ACTIVE) {
          const active = await tx.season.findFirst({
            where: { status: SeasonStatus.ACTIVE, archivedAt: null, NOT: { id } },
          });
          if (active) {
            throw new ConflictException(
              `La saison « ${active.label} » est déjà active : clôturez-la d’abord (R2).`,
            );
          }
        }

        const updated = await tx.season.update({
          where: { id },
          data: { status: to, version: { increment: 1 } },
        });

        // TODO S1 : écrire dans le journal d'audit (utilisateur, avant, après, motif).
        this.logger.log(
          `Saison ${season.label} : ${from} → ${to}${dto.reason ? ` (motif : ${dto.reason})` : ''}`,
        );
        return updated;
      },
      // Sérialisable : deux activations simultanées ne peuvent pas passer toutes les deux (R2).
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** R8 : suppression = archivage. Une saison active ne peut pas être archivée. */
  async archive(id: string, version: number): Promise<Season> {
    const season = await this.findOne(id);
    assertNotArchived(season);
    assertVersion(season, version);
    if (season.status === SeasonStatus.ACTIVE) {
      throw new ConflictException('Impossible d’archiver la saison active : clôturez-la d’abord.');
    }
    return this.writeWithVersion(id, version, { archivedAt: new Date() });
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
    'Cette saison a été modifiée par un autre administrateur : rechargez-la puis recommencez (R13).',
  );
}
