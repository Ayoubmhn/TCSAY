import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { currentMonth, monthLabel, shiftMonth } from '../../components/SalaryParts';
import { IconButton } from '../../components/ui/Button';
import { Card, CardGrid, CardRow, CardSubtitle, CardText, EmptyState, Kpi } from '../../components/ui/Card';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { fD } from '../../lib/format';
import { ACTOR_LABEL } from '../../auth/AuthContext';
import type { Actor, AuditEntry } from '../../lib/types';


const clubDay = (instant: string) => new Date(instant).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
const clubTime = (instant: string) => new Date(instant).toLocaleTimeString('fr-FR', { timeZone: 'Africa/Tunis', hour: '2-digit', minute: '2-digit' });

/**
 * Historique des actions (vAudit) : administration, entraîneurs, personnel. Jamais modifié ni supprimé (verrou en base).
 * Consultation par mois, regroupée par jour, avec le résumé du mois pour le compte rendu.
 */
export function AuditPage() {
  const [month, setMonth] = useState(currentMonth());
  const [role, setRole] = useState<'' | Actor>('');
  const q = useQuery({ queryKey: ['audit', month], queryFn: () => api.get<AuditEntry[]>('/audit', { month }) });
  const rows = (q.data ?? []).filter((a) => !role || a.roles.includes(role));

  const days = new Map<string, AuditEntry[]>();
  for (const a of rows) {
    const d = clubDay(a.createdAt);
    days.set(d, [...(days.get(d) ?? []), a]);
  }
  const byAction = new Map<string, number>();
  for (const a of rows) byAction.set(a.action, (byAction.get(a.action) ?? 0) + 1);
  const people = new Set(rows.map((a) => a.who));

  return (
    <>
      <PageHeader title="Historique des actions" subtitle="Découvrez qui a fait quoi, jour par jour, pour le compte rendu du mois." />
      <Filters>
        <IconButton aria-label="Mois précédent" onClick={() => setMonth(shiftMonth(month, -1))}>
          ‹
        </IconButton>
        <Pill tone="b">{monthLabel(month)}</Pill>
        <IconButton aria-label="Mois suivant" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= currentMonth()}>
          ›
        </IconButton>
        <FilterSelect label="Acteur" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          <option value="">Tous les acteurs</option>
          <option value="PRESIDENT">Président</option>
          <option value="ADMIN_AGENT">Agents administratifs</option>
          <option value="TECH_DIRECTOR">Direction technique</option>
          <option value="COACH">Entraîneurs</option>
        </FilterSelect>
        <button type="button" className="rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg" onClick={() => window.print()}>
          Imprimer le compte rendu
        </button>
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        <Section title={`Compte rendu · ${monthLabel(month)}`}>
          <CardGrid>
            <Card>
              <CardSubtitle>Actions enregistrées</CardSubtitle>
              <Kpi>{rows.length}</Kpi>
              <CardText>
                {days.size} jour(s) d’activité · {people.size} personne(s)
              </CardText>
            </Card>
            <Card className="min-[561px]:col-span-2">
              <CardSubtitle>Par type d’action</CardSubtitle>
              {byAction.size ? (
                <Pills>
                  {[...byAction.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([action, n]) => (
                      <Pill key={action} tone="s">
                        {action} · {n}
                      </Pill>
                    ))}
                </Pills>
              ) : (
                <CardText>Aucune action ce mois-ci.</CardText>
              )}
            </Card>
          </CardGrid>
        </Section>
        {[...days.entries()].map(([day, entries]) => (
          <Section key={day} title={`${fD(day, { weekday: 'long', day: 'numeric', month: 'long' })} · ${entries.length} action(s)`}>
            <CardGrid>
              {entries.map((a) => (
                <Card key={a.id}>
                  <CardRow>
                    <h3>{a.action}</h3>
                    <Pill tone="b">{clubTime(a.createdAt)}</Pill>
                  </CardRow>
                  <Pills>
                    <Pill tone="s">{a.who}</Pill>
                    {a.role && <Pill tone="g">{ACTOR_LABEL[a.role]}</Pill>}
                  </Pills>
                  <span className="text-sm [overflow-wrap:anywhere]">{a.target}</span>
                  {(a.before || a.after) && (
                    <Pills>
                      {a.before && (
                        <Pill tone="r" className="whitespace-normal">
                          Avant : {a.before}
                        </Pill>
                      )}
                      {a.after && (
                        <Pill tone="g" className="whitespace-normal">
                          Après : {a.after}
                        </Pill>
                      )}
                    </Pills>
                  )}
                  {a.reason && <CardText>Motif : {a.reason}</CardText>}
                </Card>
              ))}
            </CardGrid>
          </Section>
        ))}
        {rows.length === 0 && (
          <div className="mt-5">
            <EmptyState>Aucune action ce mois-ci.</EmptyState>
          </div>
        )}
      </QueryState>
      <Note>Historique en lecture seule : aucune entrée ne peut être modifiée ni supprimée, même par l’administrateur.</Note>
    </>
  );
}
