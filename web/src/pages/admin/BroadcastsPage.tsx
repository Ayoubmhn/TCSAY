import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { FormGrid, SelectField, TextArea, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { Broadcast, Group, Recipient } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';

type Kind = 'PARENTS' | 'PLAYERS' | 'COACHES';
const KINDS: [Kind, string][] = [
  ['PARENTS', 'Parents'],
  ['PLAYERS', 'Joueurs (avec compte)'],
  ['COACHES', 'Entraîneurs'],
];

/** Puce à cocher (choix multiple). */
function Chip({ on, onClick, children, danger = false }: { on: boolean; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full px-[14px] py-[7px] text-sm ${on ? (danger ? 'bg-pr text-ink' : 'bg-sel text-white') : 'bg-fld text-fg'}`}
    >
      {children}
    </button>
  );
}
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Écran ouvert depuis la notification (côté parent, joueur ou entraîneur). */
const LINKS: [string, string][] = [
  ['', 'Aucun'],
  ['/paiements', 'Mes paiements'],
  ['/seances', 'Mes séances'],
  ['/absences', 'Mes absences'],
  ['/reserver', 'Réserver un terrain'],
  ['/coach/seances', 'Séances (entraîneur)'],
  ['/coach/salaires', 'Salaires (entraîneur)'],
];

const ROLE: Record<Recipient['roles'][number], string> = { PARENT: 'Parent', PLAYER: 'Joueur', COACH: 'Entraîneur' };

/** Recherche de personnes : nom, email, téléphone ; un parent est aussi trouvé par le nom ou le code de son joueur. */
function RecipientPicker({ value, onChange, label = 'Destinataires (nom du parent, du joueur, code TCSAY, téléphone…)', tone = 'b' }: { value: Recipient[]; onChange: (v: Recipient[]) => void; label?: string; tone?: 'b' | 'r' }) {
  const [q, setQ] = useState('');
  const found = useQuery({
    queryKey: ['broadcast-recipients', q.trim()],
    queryFn: () => api.get<Recipient[]>('/notifications/broadcasts/recipients', { q: q.trim() }),
    enabled: q.trim().length >= 2,
  });
  const add = (r: Recipient) => {
    if (!value.some((x) => x.id === r.id)) onChange([...value, r]);
    setQ('');
  };
  return (
    <div className="col-span-full flex flex-col gap-2">
      <TextField
        label={label}
        full
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Tapez au moins 2 lettres"
      />
      {q.trim().length >= 2 && (
        <div className="flex flex-col gap-1.5">
          {found.data?.length ? (
            found.data.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => add(r)}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] bg-fld px-4 py-2 text-start text-sm text-fg hover:bg-btn"
              >
                <span>
                  <b className="font-medium">{r.name}</b>
                  {r.players.length > 0 && <span className="text-mut"> · parent de {r.players.join(', ')}</span>}
                </span>
                <span className="text-xs text-mut">{r.roles.map((x) => ROLE[x]).join(', ')}</span>
              </button>
            ))
          ) : (
            <CardText>{found.isPending ? 'Recherche…' : 'Aucune personne trouvée.'}</CardText>
          )}
        </div>
      )}
      {value.length > 0 && (
        <Pills>
          {value.map((r) => (
            <button key={r.id} type="button" onClick={() => onChange(value.filter((x) => x.id !== r.id))} aria-label={`Retirer ${r.name}`}>
              <Pill tone={tone}>{r.name} ✕</Pill>
            </button>
          ))}
        </Pills>
      )}
    </div>
  );
}

/**
 * Envoyer une notification (président, agent administratif ou tout rôle ayant le droit « notifications.send ») :
 * aux parents, joueurs, entraîneurs, à un groupe ou à des personnes choisies ; dans l'application et, au choix, par email.
 */
export function BroadcastsPage() {
  const [view, setView] = useViewMode('messages');
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [roles, setRoles] = useState<Kind[]>(['PARENTS']);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [groupScope, setGroupScope] = useState<Kind[]>(['PARENTS', 'PLAYERS', 'COACHES']);
  const [people, setPeople] = useState<Recipient[]>([]);
  const [excludeGroupIds, setExcludeGroupIds] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Recipient[]>([]);
  const audience = {
    roles,
    groupIds,
    groupScope,
    userIds: people.map((p) => p.id),
    excludeGroupIds,
    excludeUserIds: excluded.map((p) => p.id),
  };
  const preview = useQuery({
    queryKey: ['broadcast-preview', audience],
    queryFn: () => api.post<{ recipients: number; audience: string }>('/notifications/broadcasts/preview', audience),
  });
  const [byEmail, setByEmail] = useState(false);

  const history = useQuery({ queryKey: ['broadcasts'], queryFn: () => api.get<Broadcast[]>('/notifications/broadcasts') });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<Group[]>('/groups') });

  const send = useAction(
    () =>
      api.post<{ recipients: number; emails: number }>('/notifications/broadcasts', {
        title: title.trim(),
        body: body.trim(),
        link: link || undefined,
        ...audience,
        byEmail,
      }),
    {
      invalidate: [['broadcasts'], ['notifications'], ['emails']],
      success: (r) => `Notification envoyée à ${r.recipients} personne(s)${r.emails ? `, dont ${r.emails} par email` : ''}.`,
      onSuccess: () => {
        setTitle('');
        setBody('');
        setLink('');
        setPeople([]);
        setExcluded([]);
      },
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast('Titre obligatoire.');
    if (!body.trim()) return toast('Message obligatoire.');
    if (!preview.data?.recipients) return toast('Aucun destinataire : choisissez des parents, joueurs, entraîneurs, groupes ou personnes.');
    send.mutate();
  };

  return (
    <>
      <PageHeader title="Envoyer une notification" subtitle="Découvrez les messages envoyés par le club et écrivez-en un nouveau." action={<ViewToggle value={view} onChange={setView} />} />
      <Section title="Nouveau message">
        <Card className="max-w-[760px]">
          <FormGrid onSubmit={submit} noValidate>
            <div className="col-span-full flex flex-col gap-2">
              <span className="text-xs font-medium text-mut">Destinataires * (plusieurs choix possibles)</span>
              <div className="flex flex-wrap gap-2">
                {KINDS.map(([k, l]) => (
                  <Chip key={k} on={roles.includes(k)} onClick={() => setRoles(toggle(roles, k))}>
                    Tous les {l.toLowerCase()}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="col-span-full flex flex-col gap-2">
              <span className="text-xs font-medium text-mut">Groupes</span>
              <div className="flex flex-wrap gap-2">
                {groups.data?.map((g) => (
                  <Chip key={g.id} on={groupIds.includes(g.id)} onClick={() => (setGroupIds(toggle(groupIds, g.id)), setExcludeGroupIds(excludeGroupIds.filter((x) => x !== g.id)))}>
                    {g.name}
                  </Chip>
                ))}
              </div>
              {groupIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-mut">Dans ces groupes :</span>
                  {KINDS.map(([k, l]) => (
                    <Chip key={k} on={groupScope.includes(k)} onClick={() => setGroupScope(toggle(groupScope, k))}>
                      {l}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
            <RecipientPicker value={people} onChange={setPeople} label="Ajouter des personnes (nom du parent, du joueur, code TCSAY, téléphone…)" />
            <div className="col-span-full flex flex-col gap-2">
              <span className="text-xs font-medium text-mut">Sauf ces groupes</span>
              <div className="flex flex-wrap gap-2">
                {groups.data
                  ?.filter((g) => !groupIds.includes(g.id))
                  .map((g) => (
                    <Chip key={g.id} danger on={excludeGroupIds.includes(g.id)} onClick={() => setExcludeGroupIds(toggle(excludeGroupIds, g.id))}>
                      {g.name}
                    </Chip>
                  ))}
              </div>
            </div>
            <RecipientPicker value={excluded} onChange={setExcluded} tone="r" label="Sauf ces personnes" />
            <div className="col-span-full">
              <Pills>
                <Pill tone={preview.data?.recipients ? 'g' : 'r'}>{preview.data ? `${preview.data.recipients} destinataire(s)` : '…'}</Pill>
                {preview.data && <Pill tone="s">{preview.data.audience}</Pill>}
              </Pills>
            </div>
            <SelectField label="Écran à ouvrir (facultatif)" value={link} onChange={(e) => setLink(e.target.value)}>
              {LINKS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </SelectField>
            <TextField label="Titre *" full maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Terrains fermés samedi matin" />
            <TextArea label="Message *" full rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
            <label className="col-span-full inline-flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input type="checkbox" checked={byEmail} onChange={(e) => setByEmail(e.target.checked)} className="h-4 w-4 accent-pri" />
              Envoyer aussi par email (sauf adresses à compléter)
            </label>
            <div className="col-span-full flex flex-wrap gap-2">
              <Button variant="primary" type="submit" disabled={send.isPending}>
                {send.isPending ? 'Envoi…' : 'Envoyer'}
              </Button>
            </div>
          </FormGrid>
        </Card>
      </Section>

      <Section title="Messages envoyés">
        <QueryState isPending={history.isPending} error={history.error} refetch={history.refetch}>
          {history.data?.length ? (
            <CardGrid list={view === 'list'}>
              {history.data.map((b) => (
                <Card key={b.id}>
                  <CardRow>
                    <h3 className="min-w-0">{b.title}</h3>
                    <Pill tone="b">{formatDateTime(b.createdAt)}</Pill>
                  </CardRow>
                  <CardText>{b.body}</CardText>
                  <Pills>
                    <Pill tone="s" className="whitespace-normal">{b.audience}</Pill>
                    <Pill tone="g">
                      Lu {b.read}/{b.recipients}
                    </Pill>
                    {b.byEmail && <Pill tone="b">Aussi par email</Pill>}
                  </Pills>
                  <CardText>Par {b.sender}</CardText>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun message envoyé pour l’instant.</EmptyState>
          )}
        </QueryState>
      </Section>
      <Note>
        Le message apparaît dans la cloche des destinataires (comptes actifs). Un groupe = ses joueurs ayant un compte, leurs parents
        et ses entraîneurs. Chaque envoi est inscrit dans l’historique des actions.
      </Note>
    </>
  );
}
