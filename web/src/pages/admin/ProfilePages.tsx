import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { EstimateCard, SalaryCard } from '../../components/SalaryParts';
import { SlotLine } from '../../components/SlotInfo';
import { BigAvatar } from '../../components/ui/Avatar';
import { Card, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { InstallmentCard } from '../../components/ui/InstallmentCard';
import { KeyValue } from '../../components/ui/KeyValue';
import { QueryState } from '../../components/ui/Loading';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { DT, fD, formatDate } from '../../lib/format';
import type { CoachProfile, Installment, ParentProfile, PlayerProfile, StaffProfile } from '../../lib/types';
import { payText } from './CoachesPage';
import { PLAN_LABEL } from './PlayerFormModal';

const LINK_BTN = 'inline-flex items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg';
const ABSENCE_STATUS = { PENDING: { label: 'En attente', tone: 's' }, APPROVED: { label: 'Validée', tone: 'g' }, REJECTED: { label: 'Refusée', tone: 'r' } } as const;

/** En-tête de profil : retour, avatar, nom, pastilles, actions. */
function ProfileHeader({ back, backLabel, first, last, pills, actions }: { back: string; backLabel: string; first: string; last: string; pills?: ReactNode; actions?: ReactNode }) {
  return (
    <>
      <Link to={back} className="text-sm font-medium text-mut hover:underline">
        ‹ {backLabel}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <BigAvatar first={first || '?'} last={last} />
        <div className="flex min-w-0 flex-col gap-2">
          <h1>{`${first} ${last}`.trim()}</h1>
          {pills && <Pills>{pills}</Pills>}
        </div>
        {actions && <div className="ms-auto flex flex-wrap gap-2">{actions}</div>}
      </div>
    </>
  );
}

function InfoCard({ children }: { children: ReactNode }) {
  return (
    <Card className="max-w-[560px]">
      <div>{children}</div>
      <CardText>Informations personnelles modifiables par le club seulement.</CardText>
    </Card>
  );
}

/** Profil joueur : informations, parents, groupe et créneaux, paiements, absences. */
export function PlayerProfilePage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['player-profile', id], queryFn: () => api.get<PlayerProfile>(`/players/${id}/profile`) });
  const p = q.data;
  return (
    <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
      {p && (
        <>
          <ProfileHeader
            back="/admin/joueurs"
            backLabel="Joueurs"
            first={p.firstName}
            last={p.lastName}
            pills={
              <>
                <Pill tone="b">{p.age} ans</Pill>
                {p.category && <Pill tone="s">{p.category.name}</Pill>}
                {p.archivedAt ? <Pill tone="s">Archivé</Pill> : <Pill tone="g">Saison {p.season.label}</Pill>}
                {p.minor && <Pill tone="s">Mineur</Pill>}
              </>
            }
          />
          <Section title="Informations">
            <InfoCard>
              <KeyValue label="Naissance">{formatDate(p.birthDate)}</KeyValue>
              <KeyValue label="Genre">{p.gender === 'M' ? 'Garçon / Homme' : 'Fille / Femme'}</KeyValue>
              <KeyValue label="CIN">{p.cin ?? '—'}</KeyValue>
              <KeyValue label="Téléphone">{p.phone ?? '—'}</KeyValue>
              <KeyValue label="Email">{p.email ?? '—'}</KeyValue>
              <KeyValue label="Compte">{p.hasAccount ? 'Actif' : 'Sans compte (suivi par le parent)'}</KeyValue>
              {p.derogationReason && <KeyValue label="Dérogation">{p.derogationReason}</KeyValue>}
              <KeyValue label="Parents">
                {p.parents.length
                  ? p.parents.map((x, i) => (
                      <span key={x.id}>
                        {i > 0 && ', '}
                        <Link className="underline" to={`/admin/parents/${x.id}`}>
                          {x.firstName} {x.lastName}
                        </Link>
                      </span>
                    ))
                  : '—'}
              </KeyValue>
            </InfoCard>
          </Section>
          <Section title="Groupe">
            {p.groups.length ? (
              <CardGrid>
                {p.groups.map((g) => (
                  <Card key={g.id}>
                    <h3>{g.name}</h3>
                    {g.slots.map((s) => (
                      <SlotLine key={s.id} slot={s} />
                    ))}
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Pas encore de groupe pour cette saison.</EmptyState>
            )}
          </Section>
          <Section title="Paiements">
            {p.paymentPlan && (
              <Pills>
                <Pill tone="s">{PLAN_LABEL[p.paymentPlan]}</Pill>
                <Pill tone="b">Total {DT(p.installments.reduce((t, i) => t + i.amount, 0))}</Pill>
                <Pill tone={p.installments.some((i) => i.remaining) ? 'r' : 'g'}>Restant {DT(p.installments.reduce((t, i) => t + i.remaining, 0))}</Pill>
              </Pills>
            )}
            {p.installments.length ? (
              <CardGrid>
                {p.installments.map((i) => (
                  <InstallmentCard
                    key={i.id}
                    installment={{ ...i, player: p, season: { ...p.season, status: 'ACTIVE' } } as Installment}
                    title={`Tranche ${i.number}/${i.count}`}
                  />
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucune cotisation pour cette saison.</EmptyState>
            )}
          </Section>
          <Section title="Absences">
            <Pills>
              <Pill tone="b">{p.attendanceCount} séance(s) pointée(s)</Pill>
              <Pill tone={p.absences.length ? 'r' : 'g'}>{p.absences.length} absence(s)</Pill>
            </Pills>
            {p.absences.length ? (
              <CardGrid>
                {p.absences.map((a) => (
                  <Card key={a.id}>
                    <CardRow>
                      <h3>{a.group}</h3>
                      <Pill tone="r">Absent</Pill>
                    </CardRow>
                    <Pills>
                      <Pill tone="b">{fD(a.date)}</Pill>
                      <Pill tone="b">{a.startTime}</Pill>
                    </Pills>
                    <CardText>{a.reason}</CardText>
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucune absence.</EmptyState>
            )}
          </Section>
        </>
      )}
    </QueryState>
  );
}

/** Profil entraîneur : informations, groupes et créneaux, salaires (à venir et historique), absences. */
export function CoachProfilePage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['coach-profile', id], queryFn: () => api.get<CoachProfile>(`/coaches/${id}/profile`) });
  const c = q.data;
  const groups = c ? [...new Map(c.slots.map((s) => [s.group.id, s.group])).values()] : [];
  return (
    <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
      {c && (
        <>
          <ProfileHeader
            back="/admin/entraineurs"
            backLabel="Entraîneurs"
            first={c.firstName}
            last={c.lastName}
            pills={
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-fld px-[13px] py-[5px] text-sm font-medium">
                  <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                  Couleur au planning
                </span>
                <Pill tone={c.isActive ? 'g' : 'r'}>{c.isActive ? 'Actif' : 'Désactivé'}</Pill>
                <Pill tone="b">{c.slots.length} séance(s) / semaine</Pill>
              </>
            }
            actions={
              <Link className={LINK_BTN} to={`/admin/salaires?type=COACH&employe=${c.userId}`}>
                Gérer les salaires
              </Link>
            }
          />
          <Section title="Informations">
            <InfoCard>
              <KeyValue label="CIN">{c.cin ?? '—'}</KeyValue>
              <KeyValue label="Téléphone">{c.phone ?? '—'}</KeyValue>
              <KeyValue label="Email">{c.email ?? '— (identifiant : CIN)'}</KeyValue>
              <KeyValue label="Rémunération">{payText(c.payMode, c.payRate)}</KeyValue>
            </InfoCard>
          </Section>
          <Section title="Groupes">
            {groups.length ? (
              <CardGrid>
                {groups.map((g) => (
                  <Card key={g.id}>
                    <h3>{g.name}</h3>
                    {c.slots
                      .filter((s) => s.group.id === g.id)
                      .map((s) => (
                        <SlotLine key={s.id} slot={s} />
                      ))}
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucun groupe cette saison.</EmptyState>
            )}
          </Section>
          <Section title="Salaires">
            <CardGrid>
              {!c.salaries.some((s) => s.month === c.estimate.month) && <EstimateCard estimate={c.estimate} />}
              {c.salaries.map((s) => (
                <SalaryCard key={s.id} salary={s} />
              ))}
            </CardGrid>
          </Section>
          <Section title="Absences">
            {c.absences.length ? (
              <CardGrid>
                {c.absences.map((a) => (
                  <Card key={a.id}>
                    <CardRow>
                      <h3>{fD(a.date, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                      <Pill tone={ABSENCE_STATUS[a.status].tone}>{ABSENCE_STATUS[a.status].label}</Pill>
                    </CardRow>
                    <Pills>
                      <Pill tone="b">{a.slot ? `${a.slot.group} · ${a.slot.startTime}` : 'Toute la journée'}</Pill>
                    </Pills>
                    <CardText>{a.reason}</CardText>
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucune absence déclarée.</EmptyState>
            )}
          </Section>
        </>
      )}
    </QueryState>
  );
}

/** Profil parent : informations, enfants et leurs groupes. */
export function ParentProfilePage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['parent-profile', id], queryFn: () => api.get<ParentProfile>(`/parents/${id}/profile`) });
  const p = q.data;
  return (
    <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
      {p && (
        <>
          <ProfileHeader
            back="/admin/parents"
            backLabel="Parents"
            first={p.firstName}
            last={p.lastName}
            pills={
              <>
                <Pill tone={p.isActive ? 'g' : 'r'}>{p.isActive ? 'Actif' : 'Désactivé'}</Pill>
                <Pill tone="b">{p.children.length} enfant(s)</Pill>
              </>
            }
          />
          <Section title="Informations">
            <InfoCard>
              <KeyValue label="CIN">{p.cin ?? '—'}</KeyValue>
              <KeyValue label="Téléphone">{p.phone ?? '—'}</KeyValue>
              <KeyValue label="Email">{p.email}</KeyValue>
            </InfoCard>
          </Section>
          <Section title="Enfants">
            {p.children.length ? (
              <CardGrid>
                {p.children.map((k) => (
                  <Card key={k.id}>
                    <CardRow>
                      <Link to={`/admin/joueurs/${k.id}`} className="hover:underline">
                        <h3>
                          {k.firstName} {k.lastName}
                        </h3>
                      </Link>
                      {k.archivedAt ? <Pill tone="s">Archivé</Pill> : k.category && <Pill tone="s">{k.category}</Pill>}
                    </CardRow>
                    <CardText>Né(e) le {formatDate(k.birthDate)}</CardText>
                    {k.groups.length ? (
                      k.groups.map((g) => (
                        <div key={g.id} className="flex flex-col gap-1.5">
                          <b className="text-sm font-semibold">{g.name}</b>
                          {g.slots.map((s) => (
                            <SlotLine key={s.id} slot={s} />
                          ))}
                        </div>
                      ))
                    ) : (
                      <Pill tone="r">Sans groupe</Pill>
                    )}
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucun enfant lié.</EmptyState>
            )}
          </Section>
        </>
      )}
    </QueryState>
  );
}

/** Profil du personnel administratif : informations et salaires. */
export function StaffProfilePage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['staff-profile', id], queryFn: () => api.get<StaffProfile>(`/staff/${id}/profile`) });
  const s = q.data;
  return (
    <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
      {s && (
        <>
          <ProfileHeader
            back="/admin/personnel"
            backLabel="Personnel"
            first={s.firstName}
            last={s.lastName}
            pills={
              <>
                <Pill tone="s">{s.functionsLabel || 'Fonction à définir'}</Pill>
                <Pill tone={s.isActive ? 'g' : 'r'}>{s.isActive ? 'Actif' : 'Désactivé'}</Pill>
              </>
            }
            actions={
              s.functions[0] && (
                <Link className={LINK_BTN} to={`/admin/salaires?type=${s.functions[0]}&employe=${s.id}`}>
                  Gérer les salaires
                </Link>
              )
            }
          />
          <Section title="Informations">
            <InfoCard>
              <KeyValue label="CIN">{s.cin ?? '—'}</KeyValue>
              <KeyValue label="Téléphone">{s.phone ?? '—'}</KeyValue>
              <KeyValue label="Email">{s.email ?? '— (identifiant : CIN)'}</KeyValue>
              <KeyValue label="Rémunération">{payText(s.payMode, s.payRate)}</KeyValue>
            </InfoCard>
          </Section>
          <Section title="Salaires">
            {s.salaries.length ? (
              <CardGrid>
                {s.salaries.map((x) => (
                  <SalaryCard key={x.id} salary={x} />
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucun salaire enregistré.</EmptyState>
            )}
          </Section>
        </>
      )}
    </QueryState>
  );
}

