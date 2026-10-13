import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { CoachChip, SlotLine } from '../../components/SlotInfo';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { fD, fullName, isPlaceholderEmail } from '../../lib/format';
import type { GroupDetail, Player } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { PlayerFormModal } from './PlayerFormModal';
import { ActionIcon } from '../../components/ui/ActionIcon';

type Member = GroupDetail['members'][number];
type Candidate = GroupDetail['candidates'][number];

const rateTone = (rate: number | null) => (rate === null ? 's' : rate >= 80 ? 'g' : rate >= 60 ? 's' : 'r');

/** Fiche d'un groupe : créneaux, entraîneurs, joueurs (code, âge, parents, assiduité), dernières séances, ajout rapide. */
export function GroupDetailPage() {
  const { id } = useParams();
  const { me } = useAuth();
  const canManage = Boolean(me?.permissions.includes('groups.manage'));
  const q = useQuery({ queryKey: ['group-detail', id], queryFn: () => api.get<GroupDetail>(`/groups/${id}/detail`) });
  const [remove, setRemove] = useState<Member>();
  const [derogation, setDerogation] = useState<Candidate>();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const keys = [['group-detail', id], ['groups'], ['players'], ['planning']];
  const add = useAction(
    (v: { playerId: string; derogationReason?: string }) => api.post(`/groups/${id}/members`, v),
    { invalidate: keys, success: 'Joueur ajouté au groupe.', onSuccess: () => setDerogation(undefined) },
  );
  const removeMember = useAction((playerId: string) => api.delete(`/groups/${id}/members/${playerId}`), {
    invalidate: keys,
    success: 'Joueur retiré du groupe.',
    onSuccess: () => setRemove(undefined),
  });
  const g = q.data;
  const full = g ? g.members.length >= g.capacity : false;
  // Recherche dans les joueurs inscrits sans groupe : nom, prénom, code TCSAY, catégorie.
  const found = useMemo(() => {
    const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const words = norm(search).split(/\s+/).filter(Boolean);
    return (g?.candidates ?? [])
      .filter((c) => words.every((w) => norm(`${c.firstName} ${c.lastName} ${c.memberCode ?? ''} ${c.category.name}`).includes(w)))
      // Même catégorie que le groupe d'abord.
      .sort((a, b) => Number(b.sameCategory) - Number(a.sameCategory));
  }, [g, search]);
  // Joueur créé depuis cette page : ajouté au groupe (si la catégorie diffère, motif de dérogation demandé).
  const afterCreate = (p: Player) => {
    if (!g || full) return;
    const sameCategory = !g.category || p.category?.id === g.category.id;
    if (sameCategory) add.mutate({ playerId: p.id });
    else if (p.category) setDerogation({ playerId: p.id, memberCode: p.memberCode, firstName: p.firstName, lastName: p.lastName, age: p.age, category: { id: p.category.id, name: p.category.name }, sameCategory: false });
  };

  return (
    <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
      {g && (
        <>
          <Link to="/admin/groupes" className="text-sm font-medium text-mut hover:underline">
            ‹ Groupes
          </Link>
          <div className="mt-3 flex flex-col gap-2">
            <h1>{g.name}</h1>
            <Pills>
              <Pill tone="b">Saison {g.season.label}</Pill>
              <Pill tone={g.kind === 'LEISURE' ? 'g' : 'b'}>{g.kind === 'LEISURE' ? 'Loisirs · oct. → juin' : 'Compétitif · → août'}</Pill>
              <Pill tone="s">{g.category?.name ?? 'Catégorie à affecter'}</Pill>
              <Pill tone={full ? 'r' : 'g'}>
                {g.members.length}/{g.capacity} · {full ? 'complet' : `${g.places} place${g.places > 1 ? 's' : ''}`}
              </Pill>
              <Pill tone={rateTone(g.attendanceRate)}>
                {g.attendanceRate === null ? 'Aucune présence pointée' : `Assiduité ${g.attendanceRate} %`}
              </Pill>
            </Pills>
          </div>

          <Section title="Créneaux">
            <Card>
              {g.slots.length ? (
                <div className="flex flex-col gap-1.5">
                  {g.slots.map((s) => (
                    <SlotLine key={s.id} slot={s} />
                  ))}
                </div>
              ) : (
                <CardText>Aucun créneau.</CardText>
              )}
              {g.coaches.length > 0 && (
                <Pills>
                  {g.coaches.map((c) => (
                    <CoachChip key={c.id} coach={c} />
                  ))}
                </Pills>
              )}
            </Card>
          </Section>

          <Section title={`Joueurs (${g.members.length})`}>
            {g.members.length ? (
              <CardGrid list>
                {g.members.map((m) => (
                  <Card key={m.playerId}>
                    <CardRow>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar first={m.firstName} last={m.lastName} />
                        <div className="min-w-0">
                          <Link to={`/admin/joueurs/${m.playerId}`} className="hover:underline">
                            <h3>{fullName(m)}</h3>
                          </Link>
                          <CardText>
                            {m.memberCode ? `${m.memberCode} · ` : ''}
                            {m.age === null ? 'âge inconnu' : `${m.age} ans`}
                            {m.gender ? ` · ${m.gender === 'M' ? 'G' : 'F'}` : ''}
                          </CardText>
                        </div>
                      </div>
                    </CardRow>
                    <Pills>
                      <Pill tone={rateTone(m.attendance.rate)}>
                        {m.attendance.rate === null ? 'Pas encore pointé' : `Présent ${m.attendance.present}/${m.attendance.sessions} · ${m.attendance.rate} %`}
                      </Pill>
                      {m.attendance.absent > 0 && <Pill tone="r">{m.attendance.absent} absence(s)</Pill>}
                      {m.derogationReason && <Pill tone="s">Dérogation</Pill>}
                    </Pills>
                    <CardText>
                      {m.parents.length
                        ? m.parents.map((p) => `${fullName(p)}${p.phone ? ` · ${p.phone}` : ''}${isPlaceholderEmail(p.email) ? ' (email à compléter)' : ''}`).join(' ; ')
                        : m.phone
                          ? `Téléphone : ${m.phone}`
                          : 'Aucun contact'}
                    </CardText>
                    {canManage && (
                      <CardActions>
                        <ActionIcon kind="remove" label="Retirer du groupe" onClick={() => setRemove(m)} />
                      </CardActions>
                    )}
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucun joueur dans ce groupe.</EmptyState>
            )}
          </Section>

          <Section title="Dernières séances">
            {g.recentSessions.length ? (
              <CardGrid list>
                {g.recentSessions.map((s) => (
                  <Card key={s.date}>
                    <h3>{fD(s.date, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                    <Pills>
                      <Pill tone="g">{s.present} présent(s)</Pill>
                      {s.late > 0 && <Pill tone="s">{s.late} retard(s)</Pill>}
                      <Pill tone={s.absent ? 'r' : 'g'}>{s.absent} absent(s)</Pill>
                    </Pills>
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucune séance pointée pour l’instant.</EmptyState>
            )}
          </Section>

          {canManage && (
            <Section title="Ajouter un joueur">
              {!full && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    className="fld w-[300px] max-w-full text-fg"
                    placeholder="Chercher : nom, code TCSAY, catégorie"
                    aria-label="Chercher un joueur sans groupe"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Pill tone="b">
                    {found.length} joueur{found.length > 1 ? 's' : ''} sans groupe
                  </Pill>
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    + Créer un joueur
                  </Button>
                </div>
              )}
              {full ? (
                <EmptyState>Groupe complet (R4).</EmptyState>
              ) : found.length ? (
                <CardGrid list>
                  {found.slice(0, 30).map((c) => (
                    <Card key={c.playerId}>
                      <CardRow>
                        <Link to={`/admin/joueurs/${c.playerId}`} className="min-w-0 hover:underline">
                          <h3>{fullName(c)}</h3>
                        </Link>
                        <Pill tone={c.sameCategory ? 'g' : 's'}>{c.category.name}</Pill>
                      </CardRow>
                      <CardText>
                        {c.memberCode ? `${c.memberCode} · ` : ''}
                        {c.age === null ? 'âge inconnu' : `${c.age} ans`}
                      </CardText>
                      <CardActions>
                        <ActionIcon
                          kind="add"
                          label={c.sameCategory ? 'Ajouter au groupe' : 'Ajouter (dérogation)'}
                          primary={c.sameCategory}
                          disabled={add.isPending}
                          onClick={() => (c.sameCategory ? add.mutate({ playerId: c.playerId }) : setDerogation(c))}
                        />
                      </CardActions>
                    </Card>
                  ))}
                </CardGrid>
              ) : (
                <EmptyState>
                  {search.trim() ? 'Aucun joueur sans groupe ne correspond : créez-le avec « + Créer un joueur ».' : 'Tous les joueurs inscrits ont un groupe.'}
                </EmptyState>
              )}
              {found.length > 30 && <CardText>30 premiers résultats : affinez la recherche.</CardText>}
            </Section>
          )}

          <Note>
            Assiduité = séances présentes ou en retard / séances pointées. Ajout : capacité et catégorie vérifiées (R4) ; une
            catégorie différente demande un motif de dérogation.
          </Note>

          <PlayerFormModal open={creating} onClose={() => setCreating(false)} onCreated={afterCreate} />
          <ConfirmModal
            open={Boolean(remove)}
            title="Retirer ce joueur du groupe ?"
            text={remove ? `${fullName(remove)} restera inscrit sur la saison, sans groupe.` : ''}
            cta="Retirer"
            pending={removeMember.isPending}
            onConfirm={() => remove && removeMember.mutate(remove.playerId)}
            onClose={() => setRemove(undefined)}
          />
          <ConfirmModal
            open={Boolean(derogation)}
            title="Dérogation de catégorie"
            text={derogation ? `${fullName(derogation)} est en ${derogation.category.name}, le groupe en ${g.category?.name ?? '—'}. Motif obligatoire (R4).` : ''}
            cta="Ajouter"
            withMotif
            pending={add.isPending}
            onConfirm={(motif) => derogation && add.mutate({ playerId: derogation.playerId, derogationReason: motif })}
            onClose={() => setDerogation(undefined)}
          />
        </>
      )}
    </QueryState>
  );
}
