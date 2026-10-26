import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmailKind, Role } from '@prisma/client';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AccessService } from '../access/access.service';
import { PaymentAccessService } from '../access/payment-access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm, Roles } from '../auth/auth-user';
import { addDaysIso, dayFromIso, isoDay, todayIso, weekday } from '../common/dates';
import { NIL_UUID, notFound, rule } from '../common/rules';
import { groupPeriod, periodSelect, sessionsBetween, slotRunsOn, withPeriod } from '../common/sessions';
import { PrismaService } from '../prisma/prisma.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

class CounterQuery {
  @IsOptional()
  @IsUUID()
  seasonId?: string;

  @IsOptional()
  @Matches(DAY, { message: 'Date au format AAAA-MM-JJ.' })
  from?: string;

  @IsOptional()
  @Matches(DAY, { message: 'Date au format AAAA-MM-JJ.' })
  to?: string;

  @IsOptional()
  @IsUUID()
  coachId?: string;

  @IsOptional()
  @IsUUID()
  playerId?: string;
}

class CancelDto {
  @IsUUID()
  slotId: string;

  @Matches(DAY, { message: 'Date au format AAAA-MM-JJ.' })
  date: string;

  @IsString()
  @IsNotEmpty({ message: 'Motif obligatoire (ex. pluie, terrain fermé).' })
  @MaxLength(200)
  reason: string;

  /** Prévenir les familles et les entraîneurs du groupe (oui par défaut). */
  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

/** Séance du compteur. */
type Item = { slotId: string; date: string; startTime: string; endTime: string; minutes: number; reason: string; holiday: string | null };
/** Séance manquée par le club, avec sa séance de rattrapage éventuelle (passée ou prévue). */
type Missed = Item & { madeUp: { date: string; startTime: string; done: boolean } | null };

export type GroupCounter = {
  group: { id: string; name: string; kind: string };
  from: string;
  to: string;
  planned: { sessions: number; minutes: number };
  given: { sessions: number; minutes: number };
  /** Séances annulées ou retirées par le club (motif, rattrapage). */
  missed: Missed[];
  /** Séances en plus (stage, rattrapage, séance ponctuelle), passées ou prévues. */
  extra: (Item & { done: boolean; covers: string | null; oneOff: { id: string; type: string } | null })[];
  /** Solde : séances données − prévues (négatif = en retard, positif = en avance). */
  balance: { sessions: number; minutes: number };
  /** Séances encore dues (manquées sans rattrapage déjà fait ; un rattrapage prévu reste dû jusqu'à sa date). */
  owed: number;
};

const frDate = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Compteur des séances : pour chaque groupe, séances prévues (horaire habituel ; vacances non dues retirées), données,
 * annulées par le club (entraîneur absent sans remplaçant, terrain pris, séance annulée : pluie, fermeture ; vacances
 * dues), séances en plus (stage, rattrapage) et solde. Les absences d'un joueur ne sont jamais dues par le club.
 * Direction : tous les groupes ; entraîneur : ses groupes ; joueur / parent : les groupes de l'enfant (aucun montant).
 */
@ApiTags('Compteur des séances')
@ApiBearerAuth()
@Controller('session-counter')
export class SessionCounterController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly gate: PaymentAccessService,
  ) {}

  @Get()
  @Perm('planning.view', 'groups.manage')
  async all(@Query() q: CounterQuery) {
    const season = await this.access.seasonOrActive(q.seasonId);
    const groups = await this.prisma.trainingGroup.findMany({
      where: { seasonId: season.id, archivedAt: null, ...(q.coachId ? { slots: { some: { coaches: { some: { coachId: q.coachId } } } } } : {}) },
      select: { id: true },
    });
    return this.summary(await countGroups(this.prisma, groups.map((g) => g.id), q.from, q.to), season);
  }

  /** Entraîneur : ses groupes. */
  @Get('mine')
  @Roles(Role.COACH)
  async mine(@CurrentUser() user: AuthUser, @Query() q: CounterQuery) {
    const season = await this.access.activeSeason();
    const coachId = user.coachId ?? NIL_UUID;
    const groups = await this.prisma.trainingGroup.findMany({
      where: { seasonId: season.id, archivedAt: null, slots: { some: { coaches: { some: { coachId } } } } },
      select: { id: true },
    });
    return this.summary(await countGroups(this.prisma, groups.map((g) => g.id), q.from, q.to), season);
  }

  /** Joueur / parent : les groupes de l'enfant depuis son arrivée, et ses propres absences (jamais dues par le club). */
  @Get('player')
  @Roles(Role.PLAYER, Role.PARENT, Role.ADMIN)
  async player(@CurrentUser() user: AuthUser, @Query() q: CounterQuery) {
    const playerId = await this.access.resolvePlayer(user, q.playerId);
    if (user.role !== Role.ADMIN) await this.gate.assert(playerId, 'sessions');
    const season = await this.access.activeSeason();
    const members = await this.prisma.groupMember.findMany({
      where: { enrollment: { playerId, seasonId: season.id }, group: { archivedAt: null, seasonId: season.id } },
      select: { groupId: true, createdAt: true },
    });
    const out = [];
    for (const m of members) {
      // Prévues seulement depuis l'arrivée dans le groupe (ou sa première présence pointée, si plus ancienne).
      const first = await this.prisma.attendance.findFirst({ where: { playerId, groupId: m.groupId }, orderBy: { date: 'asc' }, select: { date: true } });
      const joined = [isoDay(m.createdAt), ...(first ? [isoDay(first.date)] : [])].sort()[0];
      const from = q.from && q.from > joined ? q.from : joined;
      const [c] = await countGroups(this.prisma, [m.groupId], from, q.to);
      if (!c) continue;
      const marks = await this.prisma.attendance.findMany({
        where: { playerId, groupId: m.groupId, date: { gte: dayFromIso(c.from), lte: dayFromIso(c.to) } },
        select: { date: true, status: true, slot: { select: { startTime: true } } },
        orderBy: { date: 'desc' },
      });
      out.push({
        ...c,
        absences: marks.filter((x) => x.status === 'ABSENT').map((x) => ({ date: isoDay(x.date), startTime: x.slot.startTime })),
        late: marks.filter((x) => x.status === 'LATE').length,
        present: marks.filter((x) => x.status === 'PRESENT').length,
      });
    }
    return { season: { id: season.id, label: season.label }, groups: out };
  }

  private summary(groups: GroupCounter[], season: { id: string; label: string }) {
    const sum = (f: (g: GroupCounter) => number) => groups.reduce((t, g) => t + f(g), 0);
    return {
      season: { id: season.id, label: season.label },
      totals: {
        planned: sum((g) => g.planned.sessions),
        given: sum((g) => g.given.sessions),
        owed: sum((g) => g.owed),
        ahead: sum((g) => Math.max(0, g.balance.sessions)),
        late: groups.filter((g) => g.owed > 0).length,
      },
      groups: groups.sort((a, b) => b.owed - a.owed || a.balance.sessions - b.balance.sessions || a.group.name.localeCompare(b.group.name)),
    };
  }
}

/**
 * Séances annulées par le club (pluie, terrain fermé…) : la séance reste visible « Annulée » avec son motif, compte
 * « à rattraper » dans le compteur, familles et entraîneurs prévenus. Refusé si des présences sont déjà pointées (R8).
 */
@ApiTags('Compteur des séances')
@ApiBearerAuth()
@Controller('session-changes')
export class SessionChangesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post('cancel')
  @HttpCode(200)
  @Perm('groups.manage')
  async cancel(@CurrentUser() user: AuthUser, @Body() dto: CancelDto) {
    const slot = await this.prisma.groupSlot.findUnique({ where: { id: dto.slotId }, include: { group: { select: { id: true, name: true, archivedAt: true, ...periodSelect } } } });
    if (!slot || slot.group.archivedAt) throw notFound('Séance');
    if (!slotRunsOn(withPeriod(slot), dto.date)) throw new BadRequestException('Ce groupe n’a pas de séance ce jour-là à cette heure.');
    if (dto.date < addDaysIso(todayIso(), -7)) throw rule.bad('R10', 'Séance trop ancienne (plus de 7 jours) : elle ne peut plus être annulée.');
    if (await this.prisma.attendance.count({ where: { slotId: slot.id, date: dayFromIso(dto.date) } })) {
      throw rule.conflict('R8', 'Présences déjà pointées : la séance a eu lieu, elle ne peut pas être annulée.');
    }
    const existing = await this.prisma.sessionChange.findUnique({ where: { slotId_date: { slotId: slot.id, date: dayFromIso(dto.date) } } });
    if (existing && existing.kind !== 'CANCELLED') throw rule.conflict('R5', 'Séance déjà déplacée ou reportée par un tournoi.');
    const reason = dto.reason.trim();
    await this.prisma.sessionChange.upsert({
      where: { slotId_date: { slotId: slot.id, date: dayFromIso(dto.date) } },
      create: { slotId: slot.id, date: dayFromIso(dto.date), kind: 'CANCELLED', reason, createdById: user.id },
      update: { reason, createdById: user.id },
    });
    await this.audit.log(user.id, {
      action: 'Séance annulée',
      entity: 'GroupSlot',
      entityId: slot.id,
      target: `${slot.group.name} · ${frDate(dto.date)} ${slot.startTime}`,
      after: reason,
    });
    let notified = 0;
    if (dto.notify !== false) {
      notified = await notifyGroup(
        this.prisma,
        slot.group.id,
        `Séance annulée : ${slot.group.name}`,
        `Séance du ${frDate(dto.date)} à ${slot.startTime} annulée (${reason}). Elle sera rattrapée.`,
      );
    }
    return { ok: true, notified };
  }

  /** Séance rétablie (annulation par erreur) : familles et entraîneurs prévenus. */
  @Delete('cancel/:slotId/:date')
  @Perm('groups.manage')
  async restore(@CurrentUser() user: AuthUser, @Param('slotId', ParseUUIDPipe) slotId: string, @Param('date') date: string) {
    if (!DAY.test(date)) throw new BadRequestException('Date au format AAAA-MM-JJ.');
    const c = await this.prisma.sessionChange.findUnique({
      where: { slotId_date: { slotId, date: dayFromIso(date) } },
      include: { slot: { select: { startTime: true, group: { select: { id: true, name: true } } } } },
    });
    if (!c || c.kind !== 'CANCELLED') throw notFound('Séance annulée');
    await this.prisma.sessionChange.delete({ where: { id: c.id } });
    await this.audit.log(user.id, {
      action: 'Séance rétablie',
      entity: 'GroupSlot',
      entityId: slotId,
      target: `${c.slot.group.name} · ${frDate(date)} ${c.slot.startTime}`,
      before: c.reason,
    });
    if (date >= todayIso()) {
      await notifyGroup(this.prisma, c.slot.group.id, `Séance rétablie : ${c.slot.group.name}`, `La séance du ${frDate(date)} à ${c.slot.startTime} a bien lieu.`);
    }
    return { ok: true };
  }
}

/** Notification aux familles (joueurs, parents) et aux entraîneurs d'un groupe. */
async function notifyGroup(prisma: PrismaService, groupId: string, title: string, body: string): Promise<number> {
  const [members, coaches] = await Promise.all([
    prisma.groupMember.findMany({
      where: { groupId, enrollment: { player: { archivedAt: null } } },
      select: { enrollment: { select: { player: { select: { userId: true, parentLinks: { where: { parent: { isActive: true } }, select: { parentId: true } } } } } } },
    }),
    prisma.slotCoach.findMany({ where: { slot: { groupId }, coach: { user: { isActive: true } } }, select: { coach: { select: { userId: true } } } }),
  ]);
  const families = new Set<string>();
  for (const m of members) {
    const p = m.enrollment.player;
    if (p.userId) families.add(p.userId);
    for (const l of p.parentLinks) families.add(l.parentId);
  }
  const coachIds = new Set(coaches.map((c) => c.coach.userId));
  for (const id of coachIds) families.delete(id);
  const rows = [
    ...[...families].map((userId) => ({ userId, kind: EmailKind.OTHER, title, body, link: '/seances' })),
    ...[...coachIds].map((userId) => ({ userId, kind: EmailKind.OTHER, title, body, link: '/coach/seances' })),
  ];
  if (rows.length) await prisma.notification.createMany({ data: rows });
  return rows.length;
}

/**
 * Calcul du compteur pour des groupes, entre `from` (défaut : début de la période du groupe) et aujourd'hui (séances
 * passées). Les séances en plus prévues jusqu'à `to` (défaut : +60 jours) sont listées comme rattrapages prévus.
 */
export async function countGroups(prisma: PrismaService, groupIds: string[], fromQ?: string, toQ?: string): Promise<GroupCounter[]> {
  if (!groupIds.length) return [];
  const groups = await prisma.trainingGroup.findMany({
    where: { id: { in: groupIds } },
    select: {
      id: true,
      name: true,
      ...periodSelect,
      slots: { include: { coaches: { select: { coachId: true } } } },
    },
  });
  const today = todayIso();
  const now = new Date();
  const out: GroupCounter[] = [];
  for (const g of groups) {
    const period = groupPeriod(g.kind, g.season);
    const from = fromQ && fromQ > period.from ? fromQ : period.from;
    const lastPast = [toQ ?? today, today, period.to].sort()[0];
    const horizon = [toQ ?? addDaysIso(today, 60), period.to].sort()[0];
    if (from > horizon) continue;
    const slots = g.slots.map((s) => withPeriod({ ...s, group: g }));
    // Prévues : horaire habituel, sans les vacances non dues (horaire remplacé) ; les vacances dues restent prévues.
    const notOwed = g.tempSchedules
      .filter((t) => t.mode === 'REPLACE' && !t.schedule.sessionsOwed)
      .map((t) => ({ from: isoDay(t.schedule.startDate), to: isoDay(t.schedule.endDate) }));
    const owedNames = g.tempSchedules.filter((t) => t.mode === 'REPLACE' && t.schedule.sessionsOwed);
    const usual = slots.filter((s) => !s.scheduleId);
    const regular = sessionsBetween(
      usual.map((s) => ({ ...s, excluded: notOwed })),
      from,
      horizon,
    );
    const baseline = regular.filter((x) => x.date <= lastPast && x.start <= now);
    const actual = sessionsBetween(slots, from, horizon);

    const range = { gte: dayFromIso(from), lte: dayFromIso(horizon) };
    const ids = slots.map((s) => s.id);
    const [changes, absences] = await Promise.all([
      prisma.sessionChange.findMany({ where: { slotId: { in: ids }, date: range, kind: { in: ['CANCELLED', 'POSTPONED'] } } }),
      prisma.coachAbsence.findMany({ where: { status: 'APPROVED', resolution: 'CANCELLED', date: range } }),
    ]);
    const key = (slotId: string, date: string) => `${slotId}|${date}`;
    const cancelReason = new Map<string, string>();
    for (const c of changes) cancelReason.set(key(c.slotId, isoDay(c.date)), c.kind === 'CANCELLED' ? c.reason : `Terrain pris (${c.reason})`);
    for (const a of absences) {
      const d = isoDay(a.date);
      for (const s of slots) {
        if (weekday(d) !== s.day) continue;
        if (a.slotId === s.id || (!a.slotId && s.coaches.some((c) => c.coachId === a.coachId))) {
          if (!cancelReason.has(key(s.id, d))) cancelReason.set(key(s.id, d), 'Entraîneur absent');
        }
      }
    }

    const item = (x: { slot: { id: string; startTime: string; endTime: string; holiday: string | null }; date: string; minutes: number }, reason = ''): Item => ({
      slotId: x.slot.id,
      date: x.date,
      startTime: x.slot.startTime,
      endTime: x.slot.endTime,
      minutes: x.minutes,
      reason,
      holiday: x.slot.holiday,
    });
    const actualKeys = new Set(actual.map((x) => key(x.slot.id, x.date)));
    const baseKeys = new Set(regular.map((x) => key(x.slot.id, x.date)));

    const missed: Missed[] = [];
    let given = 0;
    let givenMin = 0;
    for (const b of baseline) {
      const k = key(b.slot.id, b.date);
      const cancelled = cancelReason.get(k);
      if (cancelled) missed.push({ ...item(b, cancelled), madeUp: null });
      else if (!actualKeys.has(k)) {
        // Horaire remplacé par des vacances dues : séance habituelle retirée.
        const t = owedNames.find((o) => b.date >= isoDay(o.schedule.startDate) && b.date <= isoDay(o.schedule.endDate));
        missed.push({ ...item(b, t ? `Vacances « ${t.schedule.name} »` : 'Séance retirée'), madeUp: null });
      }
    }
    const extra: GroupCounter['extra'] = [];
    /** Rattrapage programmé → séance manquée qu'il remplace (créneau|date). */
    const linked = new Map<string, string>();
    for (const a of actual) {
      const k = key(a.slot.id, a.date);
      const past = a.start <= now && a.date <= lastPast;
      if (cancelReason.has(k)) continue;
      if (baseKeys.has(k)) {
        if (past) {
          given++;
          givenMin += a.minutes;
        }
        continue;
      }
      // Séance en plus (stage, rattrapage) : passée = donnée, à venir = prévue.
      if (past) {
        given++;
        givenMin += a.minutes;
      }
      // Séance ponctuelle (rattrapage, en plus, spéciale) : son nom ; rattrapage lié à une séance manquée précise.
      const t = a.slot.scheduleId ? g.tempSchedules.find((x) => x.scheduleId === a.slot.scheduleId) : undefined;
      const oneOff = t?.schedule.kind === 'ONE_OFF' ? t : undefined;
      const reason = oneOff ? oneOff.schedule.name : a.slot.holiday ? `Séance en plus (${a.slot.holiday})` : 'Séance en plus';
      extra.push({ ...item(a, reason), done: past, covers: null, oneOff: oneOff ? { id: oneOff.scheduleId, type: oneOff.schedule.oneOffType ?? 'EXTRA' } : null });
      if (oneOff?.schedule.makeupSlotId && oneOff.schedule.makeupDate) linked.set(`${a.slot.id}|${a.date}`, key(oneOff.schedule.makeupSlotId, isoDay(oneOff.schedule.makeupDate)));
    }
    // Rattrapages : chaque séance en plus (passée ou prévue) couvre la plus ancienne séance manquée avant elle.
    missed.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    extra.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    const cover = (e: GroupCounter['extra'][number], m: Missed) => {
      m.madeUp = { date: e.date, startTime: e.startTime, done: e.done };
      e.covers = m.date;
    };
    // D'abord les rattrapages programmés pour une séance précise, puis les autres séances en plus dans l'ordre.
    for (const e of extra) {
      const target = linked.get(`${e.slotId}|${e.date}`);
      const m = target ? missed.find((x) => !x.madeUp && key(x.slotId, x.date) === target) : undefined;
      if (m) cover(e, m);
    }
    for (const e of extra) {
      if (e.covers || linked.has(`${e.slotId}|${e.date}`)) continue;
      const m = missed.find((x) => !x.madeUp && x.date <= e.date);
      if (m) cover(e, m);
    }
    const plannedMin = baseline.reduce((t, x) => t + x.minutes, 0);
    out.push({
      group: { id: g.id, name: g.name, kind: g.kind },
      from,
      to: lastPast,
      planned: { sessions: baseline.length, minutes: plannedMin },
      given: { sessions: given, minutes: givenMin },
      missed,
      extra,
      balance: { sessions: given - baseline.length, minutes: givenMin - plannedMin },
      owed: missed.filter((m) => !m.madeUp?.done).length,
    });
  }
  return out;
}
