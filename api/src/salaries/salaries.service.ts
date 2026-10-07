import { Injectable, NotFoundException } from '@nestjs/common';
import { isoDay } from '../common/dates';
import { num } from '../common/money';
import { monthRange, sessionsBetween } from '../common/sessions';
import { PrismaService } from '../prisma/prisma.service';

export type Estimate = {
  employeeId: string;
  month: string;
  payMode: 'HOURLY' | 'MONTHLY' | null;
  payRate: number;
  plannedSessions: number;
  plannedHours: number;
  absentSessions: number;
  absentHours: number;
  hours: number | null;
  amount: number;
  rule: string;
};

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Calcul du salaire d'un mois (proposition, modifiable par l'admin) :
 * - à l'heure : heures des séances animées (créneaux de l'entraîneur) − absences validées ;
 * - au mois : forfait × part des heures réellement animées (règle provisoire, à confirmer avec le bureau) ;
 * - personnel au mois : forfait ; personnel à l'heure : heures à saisir.
 */
@Injectable()
export class SalariesService {
  constructor(private readonly prisma: PrismaService) {}

  async estimate(employeeId: string, month: string): Promise<Estimate> {
    const user = await this.prisma.user.findUnique({ where: { id: employeeId }, include: { coach: true } });
    if (!user) throw new NotFoundException('Employé introuvable.');
    const rate = num(user.payRate);
    const base = { employeeId, month, payMode: user.payMode, payRate: rate };

    if (!user.coach) {
      const amount = user.payMode === 'MONTHLY' ? rate : 0;
      return {
        ...base,
        plannedSessions: 0,
        plannedHours: 0,
        absentSessions: 0,
        absentHours: 0,
        hours: null,
        amount,
        rule: user.payMode === 'MONTHLY' ? 'Forfait mensuel.' : 'À l’heure : saisissez les heures du mois.',
      };
    }

    const { from, to } = monthRange(month);
    const slots = await this.prisma.groupSlot.findMany({
      where: { coaches: { some: { coachId: user.coach.id } }, group: { archivedAt: null, season: { status: 'ACTIVE' } } },
    });
    const absences = await this.prisma.coachAbsence.findMany({
      where: {
        coachId: user.coach.id,
        status: 'APPROVED',
        date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      },
    });
    const sessions = sessionsBetween(slots, from, to);
    const absent = sessions.filter((s) =>
      absences.some((a) => isoDay(a.date) === s.date && (!a.slotId || a.slotId === s.slot.id)),
    );
    const plannedMinutes = sessions.reduce((t, s) => t + s.minutes, 0);
    const absentMinutes = absent.reduce((t, s) => t + s.minutes, 0);
    const workedHours = (plannedMinutes - absentMinutes) / 60;

    const amount =
      user.payMode === 'HOURLY'
        ? workedHours * rate
        : plannedMinutes > 0
          ? rate * (1 - absentMinutes / plannedMinutes)
          : rate;

    return {
      ...base,
      plannedSessions: sessions.length,
      plannedHours: round(plannedMinutes / 60, 2),
      absentSessions: absent.length,
      absentHours: round(absentMinutes / 60, 2),
      hours: user.payMode === 'HOURLY' ? round(workedHours, 2) : null,
      amount: round(amount),
      rule:
        user.payMode === 'HOURLY'
          ? 'À l’heure : heures des séances animées, absences validées déduites.'
          : 'Au mois : forfait au prorata des heures animées (règle provisoire, à confirmer).',
    };
  }
}
