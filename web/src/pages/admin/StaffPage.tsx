import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { CredentialsModal } from '../../components/CredentialsModal';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { fullName } from '../../lib/format';
import type { Credentials, Staff } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { payText } from './CoachesPage';
import { PersonFormModal, personPayload, type PersonValues } from './PersonFormModal';

const LINK_BTN = 'inline-flex items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg';

/** Personnel administratif : agents administratifs et directeur technique (acteurs à préciser avec le bureau). */
export function StaffPage() {
  const q = useQuery({ queryKey: ['staff'], queryFn: () => api.get<Staff[]>('/staff') });
  const [form, setForm] = useState<{ open: boolean; staff?: Staff }>({ open: false });
  const [toToggle, setToToggle] = useState<Staff>();
  const [creds, setCreds] = useState<(Credentials & { name: string })[]>([]);

  const create = useAction(
    (v: PersonValues) => api.post<Credentials & { id: string }>('/staff', { ...personPayload('staff', v), email: v.email.trim() || undefined }),
    {
      invalidate: [['staff'], ['salaries']],
      success: (r) => (r.sentTo ? `Compte créé. Identifiants envoyés à ${r.sentTo}.` : 'Compte créé.'),
      onSuccess: (r, v) => {
        setForm({ open: false });
        setCreds([{ ...r, name: `${v.firstName} ${v.lastName}` }]);
      },
    },
  );
  const update = useAction((v: PersonValues) => api.patch(`/staff/${form.staff!.id}`, { version: form.staff!.version, ...personPayload('staff', v) }), {
    invalidate: [['staff'], ['salaries']],
    success: 'Compte enregistré.',
    onSuccess: () => setForm({ open: false }),
  });
  const toggle = useAction((s: Staff) => api.post(`/staff/${s.id}/${s.isActive ? 'deactivate' : 'activate'}`), {
    invalidate: [['staff']],
    success: (_r, s) => (s.isActive ? 'Compte désactivé.' : 'Compte réactivé.'),
    onSuccess: () => setToToggle(undefined),
  });

  return (
    <>
      <PageHeader
        title="Personnel"
        subtitle="Découvrez les agents administratifs et la direction technique."
        action={
          <Button variant="primary" onClick={() => setForm({ open: true })}>
            + Nouveau membre
          </Button>
        }
      />
      <div className="mt-5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {q.data?.length ? (
            <CardGrid>
              {q.data.map((s) => (
                <Card key={s.id}>
                  <CardRow>
                    <Link to={`/admin/personnel/${s.id}`} className="flex items-center gap-2.5 hover:underline">
                      <Avatar first={s.firstName} last={s.lastName} />
                      <h3>{fullName(s)}</h3>
                    </Link>
                    <Pill tone={s.isActive ? 'g' : 'r'}>{s.isActive ? 'Actif' : 'Désactivé'}</Pill>
                  </CardRow>
                  <Pills>
                    <Pill tone="s">{s.functionsLabel || 'Fonction à définir'}</Pill>
                    {s.roles.includes('PRESIDENT') && <Pill tone="g">Président</Pill>}
                    {s.roles.includes('COACH') && <Pill tone="b">Aussi entraîneur</Pill>}
                  </Pills>
                  <CardText>
                    CIN {s.cin ?? '—'} · {s.phone ?? '—'}
                    {s.email ? ` · ${s.email}` : ''}
                  </CardText>
                  <CardText>Rémunération : {payText(s.payMode, s.payRate)}</CardText>
                  <CardActions>
                    <Link className={LINK_BTN} to={`/admin/personnel/${s.id}`}>
                      Profil
                    </Link>
                    <Button onClick={() => setForm({ open: true, staff: s })}>Modifier</Button>
                    <Button variant={s.isActive ? 'danger' : 'secondary'} onClick={() => setToToggle(s)}>
                      {s.isActive ? 'Désactiver' : 'Réactiver'}
                    </Button>
                  </CardActions>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun membre du personnel.</EmptyState>
          )}
        </QueryState>
      </div>
      <Note>
        Le personnel consulte le planning des terrains et l’historique des actions (comptes rendus mensuels). Rôles exacts de
        chaque fonction : <b>à préciser avec le bureau</b>.
      </Note>

      <PersonFormModal
        open={form.open}
        kind="staff"
        title={form.staff ? 'Modifier le membre du personnel' : 'Nouveau membre du personnel'}
        editing={Boolean(form.staff)}
        initial={
          form.staff
            ? {
                firstName: form.staff.firstName,
                lastName: form.staff.lastName,
                cin: form.staff.cin ?? '',
                email: form.staff.email ?? '',
                phone: form.staff.phone ?? '',
                payMode: form.staff.payMode ?? '',
                payRate: String(form.staff.payRate),
                functions: form.staff.functions,
              }
            : undefined
        }
        pending={create.isPending || update.isPending}
        onSubmit={(v) => (form.staff ? update.mutate(v) : create.mutate(v))}
        onClose={() => setForm({ open: false })}
      />
      <CredentialsModal items={creds} onClose={() => setCreds([])} />
      <ConfirmModal
        open={Boolean(toToggle)}
        title={toToggle?.isActive ? 'Désactiver ce compte ?' : 'Réactiver ce compte ?'}
        text={toToggle?.isActive ? 'Le compte et son historique sont conservés.' : 'La personne pourra de nouveau se connecter.'}
        cta={toToggle?.isActive ? 'Désactiver' : 'Réactiver'}
        pending={toggle.isPending}
        onConfirm={() => toToggle && toggle.mutate(toToggle)}
        onClose={() => setToToggle(undefined)}
      />
    </>
  );
}
