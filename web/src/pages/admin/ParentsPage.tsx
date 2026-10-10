import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { Filters, SelectField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { changedEmail, fullName, isPlaceholderEmail, savedMessage } from '../../lib/format';
import type { Parent, Player } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { PersonFormModal, personPayload, type PersonValues } from './PersonFormModal';

const KEYS: string[][] = [['parents'], ['players']];

/** Minuscules sans accents : recherche souple. */
const norm = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Recherche sur le parent (nom, email, téléphone, CIN) et sur ses joueurs (nom, code TCSAY). */
function matches(p: Parent, q: string) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm(
    [fullName(p), p.email, p.phone, p.phone?.replace(/\D/g, ''), p.cin, ...p.players.flatMap((k) => [fullName(k), k.memberCode])].join(' '),
  );
  return words.every((w) => hay.includes(w));
}

function LinkModal({ parent, onClose }: { parent?: Parent; onClose: () => void }) {
  const players = useQuery({ queryKey: ['players', 'all'], queryFn: () => api.get<Player[]>('/players'), enabled: Boolean(parent) });
  const candidates = (players.data ?? []).filter((p) => !parent?.players.some((x) => x.id === p.id));
  const [playerId, setPlayerId] = useState('');
  useEffect(() => setPlayerId(''), [parent]);
  const link = useAction(() => api.post(`/parents/${parent!.id}/links`, { playerId }), {
    invalidate: KEYS,
    success: 'Joueur lié.',
    onSuccess: onClose,
  });
  return (
    <Modal
      open={Boolean(parent)}
      title={`Lier un joueur à ${parent ? fullName(parent) : ''}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={() => link.mutate()} disabled={!playerId || link.isPending}>
            Lier
          </Button>
        </>
      }
    >
      <SelectField label="Joueur" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
        <option value="">— Choisir —</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {fullName(p)} · {p.category?.name ?? '—'}
          </option>
        ))}
      </SelectField>
    </Modal>
  );
}

/** Parents (vParents) : comptes, enfants liés (plusieurs-à-plusieurs), désactivation. */
export function ParentsPage() {
  const q = useQuery({ queryKey: ['parents'], queryFn: () => api.get<Parent[]>('/parents') });
  const [form, setForm] = useState<{ open: boolean; parent?: Parent }>({ open: false });
  const [linkFor, setLinkFor] = useState<Parent>();
  const [toToggle, setToToggle] = useState<Parent>();
  const [unlink, setUnlink] = useState<{ parent: Parent; player: Parent['players'][number] }>();
  const [toDelete, setToDelete] = useState<Parent>();
  const [search, setSearch] = useState('');
  const rows = useMemo(() => (q.data ?? []).filter((p) => matches(p, search)), [q.data, search]);

  const create = useAction((v: PersonValues) => api.post('/parents', personPayload('parent', v)), {
    invalidate: KEYS,
    success: (_r, v) => `Parent créé. Identifiants envoyés à ${v.email}.`,
    onSuccess: () => setForm({ open: false }),
  });
  const update = useAction(
    (v: PersonValues) => {
      return api.patch<{ credentials: { sentTo: string | null } | null }>(`/parents/${form.parent!.id}`, {
        version: form.parent!.version,
        firstName: v.firstName.trim(),
        lastName: v.lastName.trim(),
        phone: v.phone.trim() || undefined,
        cin: v.cin.trim() || undefined,
        email: changedEmail(form.parent!.email, v.email),
      });
    },
    {
      invalidate: [...KEYS, ['emails']],
      success: (r) => savedMessage('Parent enregistré.', r.credentials),
      onSuccess: () => setForm({ open: false }),
    },
  );
  const toggle = useAction((p: Parent) => api.post(`/parents/${p.id}/${p.isActive ? 'deactivate' : 'activate'}`), {
    invalidate: KEYS,
    success: (_r, p) => (p.isActive ? 'Compte désactivé.' : 'Compte réactivé.'),
    onSuccess: () => setToToggle(undefined),
  });
  const remove = useAction((p: Parent) => api.delete(`/parents/${p.id}`), {
    invalidate: KEYS,
    success: (_r, p) => `${fullName(p)} supprimé.`,
    onSuccess: () => setToDelete(undefined),
  });
  const removeLink = useAction(() => api.delete(`/parents/${unlink!.parent.id}/links/${unlink!.player.id}`), {
    invalidate: KEYS,
    success: 'Lien retiré.',
    onSuccess: () => setUnlink(undefined),
  });

  return (
    <>
      <PageHeader
        title="Parents"
        subtitle="Découvrez les parents et les joueurs qui leur sont liés."
        action={
          <Button variant="primary" onClick={() => setForm({ open: true })}>
            + Nouveau parent
          </Button>
        }
      />
      <Filters>
        <input
          className="fld w-[280px] max-w-full text-fg"
          placeholder="Parent, joueur, code TCSAY ou téléphone"
          aria-label="Rechercher un parent"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {q.data && (
          <Pill tone="b">
            {rows.length} parent{rows.length > 1 ? 's' : ''}
          </Pill>
        )}
      </Filters>
      <div className="mt-2.5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {rows.length ? (
            <CardGrid>
              {rows.map((u) => (
                <Card key={u.id}>
                  <CardRow>
                    <Link to={`/admin/parents/${u.id}`} className="flex items-center gap-2.5 hover:underline">
                      <Avatar first={u.firstName} last={u.lastName} />
                      <h3>{fullName(u)}</h3>
                    </Link>
                    {!u.isActive && <Pill tone="r">Désactivé</Pill>}
                  </CardRow>
                  <Pills>
                    {u.players.map((k) => (
                      <button key={k.id} type="button" onClick={() => setUnlink({ parent: u, player: k })} aria-label={`Retirer le lien avec ${fullName(k)}`}>
                        <Pill tone="g">{fullName(k)} ✕</Pill>
                      </button>
                    ))}
                    {u.players.length === 0 && <Pill tone="s">Aucun joueur lié</Pill>}
                  </Pills>
                  <CardText>
                    {isPlaceholderEmail(u.email) ? 'Email à compléter' : u.email} · {u.phone ?? '—'} · CIN {u.cin ?? '—'}
                  </CardText>
                  <CardActions>
                    <Button onClick={() => setLinkFor(u)}>Lier un joueur</Button>
                    <Button onClick={() => setForm({ open: true, parent: u })}>Modifier</Button>
                    <Button variant={u.isActive ? 'danger' : 'secondary'} onClick={() => setToToggle(u)}>
                      {u.isActive ? 'Désactiver le compte' : 'Réactiver'}
                    </Button>
                    <Button variant="danger" onClick={() => setToDelete(u)}>
                      Supprimer
                    </Button>
                  </CardActions>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>{search.trim() ? 'Aucun parent ne correspond à cette recherche.' : 'Aucun parent.'}</EmptyState>
          )}
        </QueryState>
      </div>
      <Note>
        Un parent peut suivre plusieurs joueurs ; un joueur peut avoir plusieurs parents. Un mineur garde toujours au moins un
        parent lié (R9). Suppression possible seulement pour un compte sans historique (ex. créé en double à l’import) ;
        sinon le compte est désactivé (R8).
      </Note>

      <PersonFormModal
        open={form.open}
        kind="parent"
        title={form.parent ? 'Modifier le parent' : 'Nouveau parent'}
        editing={Boolean(form.parent)}
        initial={
          form.parent
            ? { firstName: form.parent.firstName, lastName: form.parent.lastName, email: form.parent.email, phone: form.parent.phone ?? '', cin: form.parent.cin ?? '' }
            : undefined
        }
        pending={create.isPending || update.isPending}
        onSubmit={(v) => (form.parent ? update.mutate(v) : create.mutate(v))}
        onClose={() => setForm({ open: false })}
      />
      <LinkModal parent={linkFor} onClose={() => setLinkFor(undefined)} />
      <ConfirmModal
        open={Boolean(toToggle)}
        title={toToggle?.isActive ? 'Désactiver ce compte ?' : 'Réactiver ce compte ?'}
        text={
          toToggle?.isActive
            ? `${toToggle ? fullName(toToggle) : ''} ne pourra plus se connecter. Le compte et son historique sont conservés.`
            : 'Le parent pourra de nouveau se connecter.'
        }
        cta={toToggle?.isActive ? 'Désactiver' : 'Réactiver'}
        pending={toggle.isPending}
        onConfirm={() => toToggle && toggle.mutate(toToggle)}
        onClose={() => setToToggle(undefined)}
      />
      <ConfirmModal
        open={Boolean(toDelete)}
        title="Supprimer ce parent ?"
        text={
          toDelete
            ? `Le compte de ${fullName(toDelete)} sera supprimé définitivement${toDelete.players.length ? ` et ses liens avec ${toDelete.players.map((k) => fullName(k)).join(', ')} retirés` : ''}. Refusé s’il a un historique ou si un mineur se retrouve sans parent.`
            : ''
        }
        cta="Supprimer"
        pending={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
        onClose={() => setToDelete(undefined)}
      />
      <ConfirmModal
        open={Boolean(unlink)}
        title="Retirer ce lien ?"
        text={unlink ? `${fullName(unlink.player)} ne sera plus suivi par ${fullName(unlink.parent)}.` : ''}
        cta="Retirer"
        pending={removeLink.isPending}
        onConfirm={() => removeLink.mutate()}
        onClose={() => setUnlink(undefined)}
      />
    </>
  );
}
