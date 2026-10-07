import { DT, fD } from '../lib/format';
import type { EmployeeType, Estimate, Salary } from '../lib/types';
import { Card, CardActions, CardRow, CardText, Kpi } from './ui/Card';
import { Pill, Pills } from './ui/Pill';
import type { ReactNode } from 'react';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/** « 2026-10 » → « Octobre 2026 ». */
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** Mois courant « AAAA-MM » (heure du club). */
export const currentMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' }).slice(0, 7);

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export const EMPLOYEE_TYPE_LABEL: Record<EmployeeType, string> = {
  COACH: 'Entraîneur',
  ADMIN_AGENT: 'Agent administratif',
  TECHNICAL_DIRECTOR: 'Directeur technique',
};

const h = (n: number) => `${Math.round(n * 100) / 100} h`;

/** Carte d'estimation : séances et heures prévues, absences validées déduites, montant calculé. */
export function EstimateCard({ estimate, title, children }: { estimate: Estimate; title?: string; children?: ReactNode }) {
  return (
    <Card>
      <CardRow>
        <h3>{title ?? monthLabel(estimate.month)}</h3>
        <Pill tone="s">Estimation</Pill>
      </CardRow>
      <Kpi>{DT(estimate.amount)}</Kpi>
      <Pills>
        {estimate.plannedSessions > 0 && (
          <Pill tone="b">
            {estimate.plannedSessions} séances · {h(estimate.plannedHours)}
          </Pill>
        )}
        {estimate.absentSessions > 0 && (
          <Pill tone="r">
            {estimate.absentSessions} absence{estimate.absentSessions > 1 ? 's' : ''} · −{h(estimate.absentHours)}
          </Pill>
        )}
        {estimate.payMode && (
          <Pill tone="g">{estimate.payMode === 'HOURLY' ? `${DT(estimate.payRate)} / heure` : `${DT(estimate.payRate)} / mois`}</Pill>
        )}
      </Pills>
      <CardText>{estimate.rule}</CardText>
      {children && <CardActions>{children}</CardActions>}
    </Card>
  );
}

/** Carte d'un salaire enregistré : mois, montant, heures, absences, Versé / À verser. */
export function SalaryCard({ salary, showName, children }: { salary: Salary; showName?: boolean; children?: ReactNode }) {
  return (
    <Card>
      <CardRow>
        <h3 className="flex items-center gap-2">
          {showName && salary.employee.color && (
            <span aria-hidden="true" className="h-3 w-3 flex-none rounded-full" style={{ background: salary.employee.color }} />
          )}
          {showName ? `${salary.employee.firstName} ${salary.employee.lastName}`.trim() : monthLabel(salary.month)}
        </h3>
        <Pill tone={salary.paid ? 'g' : 'r'}>{salary.paid ? 'Versé' : 'À verser'}</Pill>
      </CardRow>
      <Kpi>{DT(salary.amount)}</Kpi>
      <Pills>
        {showName && <Pill tone="b">{monthLabel(salary.month)}</Pill>}
        {salary.hours !== null && <Pill tone="b">{h(salary.hours)}</Pill>}
        {salary.absences > 0 && (
          <Pill tone="r">
            {salary.absences} absence{salary.absences > 1 ? 's' : ''}
          </Pill>
        )}
        {salary.paidAt && <Pill tone="g">Versé le {fD(salary.paidAt, { day: 'numeric', month: 'short', year: 'numeric' })}</Pill>}
      </Pills>
      {salary.note && <CardText>{salary.note}</CardText>}
      {children && <CardActions>{children}</CardActions>}
    </Card>
  );
}
