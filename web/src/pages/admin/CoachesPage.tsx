import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { QueryState } from '../../components/ui/Loading';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { fullName } from '../../lib/format';
import type { Coach } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { PersonFormModal, type PersonValues } from './PersonFormModal';

const LINK_BTN = 'inline-flex items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg';

/** Entraîneurs (vCoaches). */
export function CoachesPage() {
  const q = useQuery({ queryKey: ['coaches'], queryFn: () => api.get<Coach[]>('/coaches') });
  const [form, setForm] = useState<{ open: boolean; coach?: Coach }>({ open: false });
  const [toToggle, setToToggle] = useState<Coach>();

  const create = useAction((v: PersonValues) => api.post('/coaches', { ...v, payMode: v.payMode || undefined }), {
    invalidate: [['coaches']],
    success: (_r, v) => `Entraîneur créé. Identifiants envoyés à ${v.email}.`,
    onSuccess: () => setForm({ open: false }),
  });
  const update = useAction(
    (v: PersonValues) =>
      api.patch(`/coaches/${form.coach!.id}`, {
        version: form.coach!.version,
        firstName: v.firstName,
        lastName: v.lastName,
        phone: v.phone,
        payMode: v.payMode,
      }),
    { invalidate: [['coaches']], success: 'Entraîneur enregistré.', onSuccess: () => setForm({ open: false }) },
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
        subtitle="Découvrez les entraîneurs et leurs groupes."
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
                    <div className="flex items-center gap-2.5">
                      <Avatar first={c.firstName} last={c.lastName} />
                      <h3>{fullName(c)}</h3>
                    </div>
                    <Pill tone={c.isActive ? 'g' : 'r'}>{c.isActive ? 'Actif' : 'Désactivé'}</Pill>
                  </CardRow>
                  <Pills>
                    {c.groups.map((g) => (
                      <Pill key={g.id} tone="s">
                        {g.name}
                      </Pill>
                    ))}
                    {c.groups.length === 0 && <Pill tone="s">Aucun groupe</Pill>}
                  </Pills>
                  <CardText>
                    {c.email} · {c.phone ?? '—'}
                  </CardText>
                  <CardText>Rémunération : {c.payMode ?? 'à confirmer'}</CardText>
                  <CardActions>
                    <Link className={LINK_BTN} to="/admin/salaires">
                      Salaires
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
        title={form.coach ? 'Modifier l’entraîneur' : 'Nouvel entraîneur'}
        editing={Boolean(form.coach)}
        withPayMode
        initial={form.coach ? { ...form.coach, phone: form.coach.phone ?? '', payMode: form.coach.payMode ?? '' } : undefined}
        pending={create.isPending || update.isPending}
        onSubmit={(v) => (form.coach ? update.mutate(v) : create.mutate(v))}
        onClose={() => setForm({ open: false })}
      />
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
