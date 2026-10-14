import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, EmptyState } from '../../components/ui/Card';
import { Filters, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Segmented } from '../../components/ui/Segmented';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { api } from '../../lib/api';
import { useAction } from '../../lib/useAction';

type Row = { kind: 'player' | 'user'; id: string; name: string; detail: string; login: string | null; hasPassword: boolean; owner: string };

/** Saisie de l'identifiant et du mot de passe IJIN d'une personne (mot de passe jamais relu par le club). */
function EditModal({ row, onClose }: { row?: Row; onClose: () => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    if (row) (setLogin(row.login ?? ''), setPassword(''));
  }, [row]);
  const save = useAction(() => api.put('/federation/accounts', { kind: row!.kind, id: row!.id, login: login.trim(), password: password || undefined }), {
    invalidate: [['federation-accounts']],
    success: login.trim() ? 'Compte IJIN enregistré : la personne est prévenue.' : 'Compte IJIN retiré.',
    onSuccess: onClose,
  });
  return (
    <Modal
      open={Boolean(row)}
      title={row ? `Compte IJIN · ${row.name}` : ''}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={() => save.mutate()} disabled={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <TextField label="Identifiant IJIN (vide = retirer le compte)" autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} />
        <TextField
          label={row?.hasPassword ? 'Nouveau mot de passe (vide = inchangé)' : 'Mot de passe IJIN'}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Note>Visible ensuite par {row?.owner === 'parents' ? 'les parents du joueur' : 'la personne'} dans Paramètres › Compte fédération. Le club ne peut pas relire le mot de passe.</Note>
      </div>
    </Modal>
  );
}

/** Comptes fédération (IJIN) : le club saisit l'identifiant et le mot de passe de chaque joueur et entraîneur. */
export function FederationAccountsPage() {
  const [view, setView] = useViewMode('ijin');
  const [kind, setKind] = useState<'players' | 'coaches'>('players');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Row>();
  const list = useQuery({ queryKey: ['federation-accounts', kind, q.trim()], queryFn: () => api.get<Row[]>('/federation/accounts', { kind, q: q.trim() || undefined }) });
  const rows = list.data ?? [];
  const done = rows.filter((r) => r.login).length;

  return (
    <>
      <PageHeader title="Comptes IJIN" subtitle="Découvrez les comptes fédération des joueurs et entraîneurs, et saisissez-les." action={<ViewToggle value={view} onChange={setView} />} />
      <Filters>
        <Segmented
          label="Personnes"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'players', label: 'Joueurs' },
            { value: 'coaches', label: 'Entraîneurs' },
          ]}
        />
        <input className="fld w-[240px] text-fg" placeholder="Rechercher un nom ou un code" aria-label="Rechercher un nom ou un code" value={q} onChange={(e) => setQ(e.target.value)} />
      </Filters>
      <QueryState isPending={list.isPending} error={list.error} refetch={list.refetch}>
        <Pills className="my-[18px]">
          <Pill tone="b">{rows.length} personne(s)</Pill>
          <Pill tone="g">{done} compte(s) saisi(s)</Pill>
          {rows.length > done && <Pill tone="s">{rows.length - done} à saisir</Pill>}
        </Pills>
        {rows.length ? (
          <CardGrid list={view === 'list'}>
            {rows.map((r) => (
              <Card key={r.kind + r.id}>
                <CardRow>
                  <h3>{r.name}</h3>
                </CardRow>
                <Pills>
                  <Pill tone="s">{r.detail}</Pill>
                  {r.login ? <Pill tone="g">IJIN : {r.login}</Pill> : <Pill tone="r">Non saisi</Pill>}
                  {r.hasPassword && <Pill tone="b">Mot de passe enregistré</Pill>}
                </Pills>
                <CardActions>
                  <ActionIcon kind={r.login ? 'edit' : 'add'} primary={!r.login} label={r.login ? 'Modifier le compte IJIN' : 'Saisir le compte IJIN'} onClick={() => setEditing(r)} />
                </CardActions>
              </Card>
            ))}
          </CardGrid>
        ) : (
          <EmptyState>Aucune personne trouvée.</EmptyState>
        )}
      </QueryState>
      <Note>
        Le mot de passe est chiffré : seul son propriétaire (ou les parents d’un joueur sans compte) peut l’afficher. Chaque saisie
        prévient la personne par notification et figure dans l’historique, sans le mot de passe.
      </Note>
      <EditModal row={editing} onClose={() => setEditing(undefined)} />
    </>
  );
}
