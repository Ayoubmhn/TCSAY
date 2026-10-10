import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { ACTOR_LABEL } from '../../auth/AuthContext';
import { CredentialsModal } from '../../components/CredentialsModal';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { QueryState } from '../../components/ui/Loading';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { changedEmail, DT, fullName, isPlaceholderEmail, savedMessage } from '../../lib/format';
import type { Coach, Credentials } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { PersonFormModal, personPayload, type PersonValues } from './PersonFormModal';

const LINK_BTN = 'inline-flex items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg';

export const payText = (mode: 'HOURLY' | 'MONTHLY' | null, rate: number) =>
  mode === 'HOURLY' ? `${DT(rate)} / heure` : mode === 'MONTHLY' ? `${DT(rate)} / mois` : 'à définir';

/** Entraîneurs (vCoaches) : couleur au planning, rémunération à l'heure ou au mois, profil au clic. */
export function CoachesPage() {
  const q = useQuery({ queryKey: ['coaches'], queryFn: () => api.get<Coach[]>('/coaches') });
  const [form, setForm] = useState<{ open: boolean; coach?: Coach }>({ open: false });
  const [toToggle, setToToggle] = useState<Coach>();
  const [creds, setCreds] = useState<(Credentials & { name: string })[]>([]);

  const create = useAction(
    (v: PersonValues) => api.post<Credentials & { id: string }>('/coaches', { ...personPayload('coach', v), email: v.email.trim() || undefined }),
    {
      invalidate: [['coaches']],
      success: (r) => (r.sentTo ? `Entraîneur créé. Identifiants envoyés à ${r.sentTo}.` : 'Entraîneur créé.'),
      onSuccess: (r, v) => {
        setForm({ open: false });
        setCreds([{ ...r, name: `${v.firstName} ${v.lastName}` }]);
      },
    },
  );
  const update = useAction(
    (v: PersonValues) =>
      api.patch<{ credentials: Credentials | null }>(`/coaches/${form.coach!.id}`, {
        version: form.coach!.version,
        ...personPayload('coach', v),
        email: changedEmail(form.coach!.email, v.email),
      }),
    {
      invalidate: [['coaches'], ['planning'], ['groups'], ['emails']],
      success: (r) => savedMessage('Entraîneur enregistré.', r.credentials),
      onSuccess: (r, v) => {
        setForm({ open: false });
        if (r.credentials) setCreds([{ ...r.credentials, name: `${v.firstName} ${v.lastName}` }]);
      },
    },
  );
  const toggle = useAction((c: Coach) => api.post(`/coaches/${c.id}/${c.isActive ? 'deactivate' : 'activate'}`), {
    invalidate: [['coaches']],
    success: (_r, c) => (c.isActive ? 'Compte désactivé.' : 'Compte réactivé.'),
    onSuccess: () => setToToggle(undefined),
  });

  return (
    <>
      <PageHeader
        title="Entraîneurs"
        subtitle="Découvrez les entraîneurs, leurs groupes et leur rémunération."
        action={
          <Button variant="primary" onClick={() => setForm({ open: true })}>
            + Nouvel entraîneur
          </Button>
        }
      />
      <div className="mt-5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {q.data?.length ? (
            <CardGrid>
              {q.data.map((c) => (
                <Card key={c.id}>
                  <CardRow>
                    <Link to={`/admin/entraineurs/${c.id}`} className="flex items-center gap-2.5 hover:underline">
                      <span className="relative">
                        <Avatar first={c.firstName} last={c.lastName} />
                        <span aria-hidden="true" className="absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-card" style={{ background: c.color }} />
                      </span>
                      <h3>{fullName(c).trim()}</h3>
                    </Link>
                    <Pill tone={c.isActive ? 'g' : 'r'}>{c.isActive ? 'Actif' : 'Désactivé'}</Pill>
                  </CardRow>
                  <Pills>
                    <Pill tone="b">{c.sessionsPerWeek} séance{c.sessionsPerWeek > 1 ? 's' : ''} / semaine</Pill>
                    {c.otherRoles?.map((r) => (
                      <Pill key={r} tone="g">
                        Aussi {ACTOR_LABEL[r].toLowerCase()}
                      </Pill>
                    ))}
                    {c.groups.map((g) => (
                      <Pill key={g.id} tone="s">
                        {g.name}
                      </Pill>
                    ))}
                    {c.groups.length === 0 && <Pill tone="s">Aucun groupe</Pill>}
                  </Pills>
                  <CardText>
                    CIN {c.cin ?? '—'} · {c.phone ?? '—'}
                    {c.email ? ` · ${isPlaceholderEmail(c.email) ? 'email à compléter' : c.email}` : ''}
                  </CardText>
                  <CardText>Rémunération : {payText(c.payMode, c.payRate)}</CardText>
                  <CardActions>
                    <Link className={LINK_BTN} to={`/admin/entraineurs/${c.id}`}>
                      Profil
                    </Link>
                    <Button onClick={() => setForm({ open: true, coach: c })}>Modifier</Button>
                    <Button variant={c.isActive ? 'danger' : 'secondary'} onClick={() => setToToggle(c)}>
                      {c.isActive ? 'Désactiver' : 'Réactiver'}
                    </Button>
                  </CardActions>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun entraîneur.</EmptyState>
          )}
        </QueryState>
      </div>

      <PersonFormModal
        open={form.open}
        kind="coach"
        title={form.coach ? 'Modifier l’entraîneur' : 'Nouvel entraîneur'}
        editing={Boolean(form.coach)}
        initial={
          form.coach
            ? {
                firstName: form.coach.firstName,
                lastName: form.coach.lastName,
                cin: form.coach.cin ?? '',
                email: form.coach.email ?? '',
                phone: form.coach.phone ?? '',
                payMode: form.coach.payMode ?? '',
                payRate: String(form.coach.payRate),
                color: form.coach.color,
              }
            : undefined
        }
        pending={create.isPending || update.isPending}
        onSubmit={(v) => (form.coach ? update.mutate(v) : create.mutate(v))}
        onClose={() => setForm({ open: false })}
      />
      <CredentialsModal items={creds} onClose={() => setCreds([])} />
      <ConfirmModal
        open={Boolean(toToggle)}
        title={toToggle?.isActive ? 'Désactiver ce compte ?' : 'Réactiver ce compte ?'}
        text={
          toToggle?.isActive
            ? `${toToggle ? fullName(toToggle) : ''} ne pourra plus se connecter. Le compte et son historique sont conservés.`
            : 'L’entraîneur pourra de nouveau se connecter.'
        }
        cta={toToggle?.isActive ? 'Désactiver' : 'Réactiver'}
        pending={toggle.isPending}
        onConfirm={() => toToggle && toggle.mutate(toToggle)}
        onClose={() => setToToggle(undefined)}
      />
    </>
  );
}
