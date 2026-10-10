import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, Season, SeasonStatus } from '@prisma/client';
import { AuthUser } from '../auth/auth-user';
import { dayFromIso } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';

/** Visibilité des lignes : admin tout ; joueur lui-même ; parent ses enfants ; coach ses groupes. */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Joueurs que l'utilisateur peut suivre (joueur : lui-même, parent : ses enfants). */
  async ownPlayerIds(user: AuthUser): Promise<string[]> {
    if (user.role === Role.PLAYER) return user.playerId ? [user.playerId] : [];
    if (user.role === Role.PARENT) {
      const links = await this.prisma.parentLink.findMany({
        where: { parentId: user.id, player: { archivedAt: null } },
        select: { playerId: true },
      });
      return links.map((l) => l.playerId);
    }
    return [];
  }

  /** Vérifie qu'un joueur/parent peut consulter ce joueur ; l'admin peut tout. Renvoie l'identifiant à utiliser. */
  async resolvePlayer(user: AuthUser, playerId?: string): Promise<string> {
    if (user.role === Role.ADMIN) {
      if (!playerId) throw new ForbiddenException('Précisez le joueur.');
      return playerId;
    }
    const own = await this.ownPlayerIds(user);
    const id = playerId ?? own[0];
    if (!id) throw new NotFoundException('Aucun joueur lié à ce compte.');
    if (!own.includes(id)) throw new ForbiddenException('Ce joueur n’est pas lié à votre compte.');
    return id;
  }

  /** Coach : vérifie qu'il anime ce créneau ; l'admin peut tout. */
  /**
   * Accès à une séance : administration, entraîneur du créneau, ou entraîneur remplaçant ce jour-là
   * (absence validée avec remplacement).
   */
  async assertSlotAccess(user: AuthUser, slotId: string, date?: string): Promise<void> {
    if (user.role === Role.ADMIN) return;
    const slot = await this.prisma.groupSlot.findUnique({ where: { id: slotId }, include: { coaches: true } });
    if (!slot) throw new NotFoundException('Séance introuvable.');
    if (user.role !== Role.COACH || !user.coachId) throw new ForbiddenException('Cette séance n’est pas la vôtre.');
    if (slot.coaches.some((c) => c.coachId === user.coachId)) return;
    if (date) {
      const replacing = await this.prisma.coachAbsence.count({
        where: {
          replacementCoachId: user.coachId,
          status: 'APPROVED',
          resolution: 'REPLACED',
          date: dayFromIso(date),
          OR: [{ slotId }, { slotId: null, coach: { slots: { some: { slotId } } } }],
        },
      });
      if (replacing) return;
    }
    throw new ForbiddenException('Cette séance n’est pas la vôtre.');
  }

  async activeSeason(): Promise<Season> {
    const season = await this.prisma.season.findFirst({ where: { status: SeasonStatus.ACTIVE, archivedAt: null } });
    if (!season) throw new NotFoundException('Aucune saison active : activez une saison.');
    return season;
  }

  /** Saison demandée, sinon la saison active. */
  async seasonOrActive(seasonId?: string): Promise<Season> {
    if (!seasonId) return this.activeSeason();
    const season = await this.prisma.season.findUnique({ where: { id: seasonId } });
    if (!season) throw new NotFoundException('Saison introuvable.');
    return season;
  }
}
