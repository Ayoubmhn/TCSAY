import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ACTOR_LABEL } from '../../auth/AuthContext';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardSubtitle, CardText, EmptyState } from '../../components/ui/Card';
import { Filters, SelectField, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import type { Actor } from '../../lib/types';
import { useAction } from '../../lib/useAction';

type Overview = {
  catalog: { key: string; label: string; group: string }[];
  roles: { role: Actor; label: string }[];
  matrix: Record<string, string[]>;
};

type UserRoles = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  cin: string | null;
  isActive: boolean;
  roles: Actor[];
  hasPlayer: boolean;
  version: number;
};

const ASSIGNABLE: Actor[] = ['PRESIDENT', 'ADMIN_AGENT', 'SUPERVISOR', 'TECH_DIRECTOR', 'COACH', 'PARENT', 'PLAYER'];

/** Case à cocher en pastille (accessible au clavier). */
function CheckChip({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange: () => void }) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-[13px] py-[6px] text-[13px] font-medium ${
        checked ? 'bg-pg text-ink' : 'bg-fld text-fg'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} className="h-4 w-4 accent-pri" />
      {label}
    </label>
  );
}

/** Droits d'un rôle, groupés par thème, avec enregistrement. */
function RoleCard({ role, label, catalog, current }: { role: Actor; label: string; catalog: Overview['catalog']; current: string[] }) {
  const [perms, setPerms] = useState<string[]>(current);
  useEffect(() => setPerms(current), [current]);
  const dirty = [...perms].sort().join() !== [...current].sort().join();
  const save = useAction(() => api.put(`/permissions/roles/${role}`, { permissions: perms }), {
    invalidate: [['permissions'], ['me']],
    success: `Droits « ${label} » enregistrés.`,
  });
  const groups = [...new Set(catalog.map((c) => c.group))];
  const toggle = (k: string) => setPerms((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  return (
    <Card>
      <CardRow>
        <h3>{label}</h3>
        <Pill tone="b">{perms.length} droit(s)</Pill>
      </CardRow>
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-1.5">
          <CardSubtitle>{g}</CardSubtitle>
          <div className="flex flex-wrap gap-1.5">
            {catalog
              .filter((c) => c.group === g)
              .map((c) => (
                <CheckChip key={c.key} checked={perms.includes(c.key)} label={c.label} onChange={() => toggle(c.key)} />
              ))}
          </div>
        </div>
      ))}
      <CardActions>
        <Button variant="primary" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          Enregistrer
        </Button>
        {dirty && <Button onClick={() => setPerms(current)}>Annuler</Button>}
      </CardActions>
    </Card>
  );
}

/** Rôles d'un compte (un compte peut cumuler plusieurs acteurs). */
function UserCard({ user }: { user: UserRoles }) {
  const [roles, setRoles] = useState<Actor[]>(user.roles);
  useEffect(() => setRoles(user.roles), [user.roles]);
  const dirty = [...roles].sort().join() !== [...user.roles].sort().join();
  // Rôle joueur pour un compte sans fiche joueur : genre et naissance pour créer la fiche (catégorie proposée).
  const needsPlayer = roles.includes('PLAYER') && !user.hasPlayer;
  const [gender, setGender] = useState<'' | 'M' | 'F'>('');
  const [birthDate, setBirthDate] = useState('');
  const toast = useToast();
  const save = useAction(
    () =>
      api.put(`/permissions/users/${user.id}`, {
        version: user.version,
        roles,
        player: needsPlayer ? { gender, birthDate } : undefined,
      }),
    {
      invalidate: [['permission-users'], ['coaches'], ['staff'], ['parents'], ['players'], ['me']],
      success: needsPlayer ? `Fiche joueur créée et rôles de ${user.firstName} enregistrés.` : `Rôles de ${user.firstName} enregistrés.`,
    },
  );
  const submit = () => {
    if (needsPlayer && (!gender || !birthDate)) return toast('Rôle joueur : indiquez le genre et la date de naissance.');
    save.mutate();
  };
  const toggle = (r: Actor) => setRoles((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]));
  return (
    <Card>
      <CardRow>
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar first={user.firstName || '?'} last={user.lastName} />
          <div className="min-w-0">
            <h3 className="truncate">{`${user.firstName} ${user.lastName}`.trim()}</h3>
            <CardText>{user.email ?? `CIN ${user.cin ?? '—'}`}</CardText>
          </div>
        </div>
        {!user.isActive && <Pill tone="r">Désactivé</Pill>}
      </CardRow>
      <div className="flex flex-wrap gap-1.5">
        {ASSIGNABLE.map((r) => (
          <CheckChip
            key={r}
            checked={roles.includes(r)}
            label={ACTOR_LABEL[r]}
            onChange={() => toggle(r)}
          />
        ))}
      </div>
      {needsPlayer && (
        <div className="grid grid-cols-1 gap-2.5 min-[520px]:grid-cols-2">
          <SelectField label="Genre (fiche joueur) *" value={gender} onChange={(e) => setGender(e.target.value as '' | 'M' | 'F')}>
            <option value="">—</option>
            <option value="M">Garçon / Homme</option>
            <option value="F">Fille / Femme</option>
          </SelectField>
          <TextField label="Date de naissance *" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          <CardText>Une fiche joueur est créée (code TCSAY, catégorie proposée selon l’âge et le genre).</CardText>
        </div>
      )}
      {dirty && (
        <CardActions>
          <Button variant="primary" onClick={submit} disabled={save.isPending || roles.length === 0}>
            Enregistrer
          </Button>
          <Button onClick={() => setRoles(user.roles)}>Annuler</Button>
        </CardActions>
      )}
    </Card>
  );
}

/**
 * Autorisations (président) : droits de chaque rôle de l'administration, rôles de chaque compte.
 * Le président a toujours tous les droits ; il reste au moins un président actif (R12).
 */
export function PermissionsPage() {
  const overview = useQuery({ queryKey: ['permissions'], queryFn: () => api.get<Overview>('/permissions') });
  const [q, setQ] = useState('');
  const users = useQuery({
    queryKey: ['permission-users', q],
    queryFn: () => api.get<UserRoles[]>('/permissions/users', { q: q.trim() || undefined }),
  });
  const o = overview.data;

  return (
    <>
      <PageHeader title="Autorisations" subtitle="Découvrez les droits de chaque rôle et attribuez les rôles des comptes." />
      <Section title="Droits par rôle">
        <QueryState isPending={overview.isPending} error={overview.error} refetch={overview.refetch}>
          {o && (
            <CardGrid className="min-[1101px]:grid-cols-2">
              <Card>
                <CardRow>
                  <h3>Président</h3>
                  <Pill tone="g">Tous les droits</Pill>
                </CardRow>
                <CardText>Accès complet, y compris ce module. Non modifiable.</CardText>
                <Pills>
                  {o.catalog.map((c) => (
                    <Pill key={c.key} tone="s">
                      {c.label}
                    </Pill>
                  ))}
                </Pills>
              </Card>
              {o.roles.map((r) => (
                <RoleCard key={r.role} role={r.role} label={r.label} catalog={o.catalog} current={o.matrix[r.role] ?? []} />
              ))}
            </CardGrid>
          )}
        </QueryState>
      </Section>

      <Section title="Rôles des comptes">
        <Filters>
          <input
            className="fld w-[260px] text-fg"
            placeholder="Rechercher (nom, email, CIN)"
            aria-label="Rechercher un compte"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Filters>
        <QueryState isPending={users.isPending} error={users.error} refetch={users.refetch}>
          {users.data?.length ? (
            <CardGrid>
              {users.data.map((u) => (
                <UserCard key={u.id} user={u} />
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun compte.</EmptyState>
          )}
        </QueryState>
      </Section>
      <Note>
        Un compte peut cumuler plusieurs rôles (ex. directeur technique et entraîneur, entraîneur et joueur) : il choisit son
        espace dans le menu. Rôle joueur : cocher « Joueur » crée sa fiche (genre et naissance demandés). Il reste
        toujours au moins un président actif (R12).
      </Note>
    </>
  );
}
