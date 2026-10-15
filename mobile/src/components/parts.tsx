import { View } from 'react-native';
import { DT, fD, fDYear, fullName, monthLabel } from '../lib/format';
import { PILL, useTheme, type PillTone } from '../lib/theme';
import type { CoachRef, Estimate, Installment, Salary } from '../lib/types';
import { Card, CardRow, CardTitle, Kpi, Pill, Pills, ProgressBar, T } from './ui';

export const INSTALLMENT_STATUS: Record<Installment['status'], { label: string; tone: PillTone }> = {
  PAID: { label: 'Payée', tone: 'g' },
  PARTIAL: { label: 'Partiel', tone: 'r' },
  DUE: { label: 'À payer', tone: 'r' },
  LATE: { label: 'En retard', tone: 'r' },
};

/** Carte de tranche : fond payé / à payer, « Montant payé / Montant restant », barre de progression, n° de reçus. */
export function InstallmentCard({ i }: { i: Installment }) {
  const { t } = useTheme();
  const st = INSTALLMENT_STATUS[i.status];
  const receipts = (i.payments ?? []).flatMap((p) => (p.receipt ? [p.receipt.number] : []));
  return (
    <View style={{ backgroundColor: i.remaining ? t.topay : t.paid, borderColor: t.line, borderWidth: 1.5, borderRadius: 24, padding: 18, gap: 12 }}>
      <CardRow>
        <CardTitle>
          Tranche {i.number}/{i.count}
        </CardTitle>
        <Pill tone={st.tone}>{st.label}</Pill>
      </CardRow>
      <Pills>
        <Pill tone="b">Échéance {fDYear(i.dueDate)}</Pill>
      </Pills>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <T size={12} mut>
            Montant payé
          </T>
          <T w="semibold" size={20}>
            {DT(i.paid)}
          </T>
        </View>
        <View style={{ flex: 1 }}>
          <T size={12} mut>
            Montant restant
          </T>
          <T w="semibold" size={20}>
            {DT(i.remaining)}
          </T>
        </View>
      </View>
      <ProgressBar value={i.paid} max={i.amount} />
      {receipts.length > 0 && (
        <Pills>
          {receipts.map((n) => (
            <Pill key={n} tone="g">
              Reçu n° {n}
            </Pill>
          ))}
        </Pills>
      )}
    </View>
  );
}

export const coachNames = (coaches: CoachRef[]) =>
  coaches.length ? `${coaches.length > 1 ? 'Coachs' : 'Coach'} ${coaches.map(fullName).join(', ')}` : '';

const h = (n: number) => `${Math.round(n * 100) / 100} h`;

export function SalaryCard({ salary }: { salary: Salary }) {
  return (
    <Card>
      <CardRow>
        <CardTitle>{monthLabel(salary.month)}</CardTitle>
        <Pill tone={salary.paid ? 'g' : 'r'}>{salary.paid ? 'Versé' : 'À verser'}</Pill>
      </CardRow>
      <Kpi>{DT(salary.amount)}</Kpi>
      <Pills>
        {salary.hours !== null && <Pill tone="b">{h(salary.hours)}</Pill>}
        {salary.absences > 0 && <Pill tone="r">{`${salary.absences} absence${salary.absences > 1 ? 's' : ''}`}</Pill>}
        {salary.paidAt && <Pill tone="g">Versé le {fDYear(salary.paidAt)}</Pill>}
      </Pills>
      {salary.note ? <T mut size={13}>{salary.note}</T> : null}
    </Card>
  );
}

export function EstimateCard({ estimate }: { estimate: Estimate }) {
  return (
    <Card>
      <CardRow>
        <CardTitle>{monthLabel(estimate.month)}</CardTitle>
        <Pill tone="s">Estimation</Pill>
      </CardRow>
      <Kpi>{DT(estimate.amount)}</Kpi>
      <Pills>
        {estimate.plannedSessions > 0 && <Pill tone="b">{`${estimate.plannedSessions} séances · ${h(estimate.plannedHours)}`}</Pill>}
        {estimate.absentSessions > 0 && <Pill tone="r">{`${estimate.absentSessions} absence(s) · −${h(estimate.absentHours)}`}</Pill>}
        {estimate.payMode && <Pill tone="g">{estimate.payMode === 'HOURLY' ? `${DT(estimate.payRate)} / heure` : `${DT(estimate.payRate)} / mois`}</Pill>}
      </Pills>
      <T mut size={13}>
        {estimate.rule}
      </T>
    </Card>
  );
}

/** Décision de la direction quand l'entraîneur est absent. */
export function ResolutionPill({ resolution, replacement }: { resolution: string | null; replacement: CoachRef | null }) {
  if (resolution === 'REPLACED') return <Pill tone="s">{replacement ? `Remplacé par ${fullName(replacement)}` : 'Coach remplacé'}</Pill>;
  if (resolution === 'PHYSICAL') return <Pill tone="s">Séance physique</Pill>;
  if (resolution === 'CANCELLED') return <Pill tone="r">Annulée</Pill>;
  return null;
}

export const dateLabel = fD;
export const PILL_COLORS = PILL;
