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
import type { Broadcast, BroadcastTarget, Group, Recipient } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const TARGETS: [BroadcastTarget, string][] = [
  ['PARENTS', 'Tous les parents'],
  ['PLAYERS', 'Tous les joueurs (avec compte)'],
  ['COACHES', 'Tous les entraîneurs'],
  ['ALL', 'Parents, joueurs et entraîneurs'],
  ['GROUP', 'Un groupe (joueurs, parents, entraîneurs)'],
  ['USERS', 'Des personnes choisies'],
];

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
function RecipientPicker({ value, onChange }: { value: Recipient[]; onChange: (v: Recipient[]) => void }) {
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
        label="Destinataires (nom du parent, du joueur, code TCSAY, téléphone…)"
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
              <Pill tone="b">{r.name} ✕</Pill>
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
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [target, setTarget] = useState<BroadcastTarget>('PARENTS');
  const [groupId, setGroupId] = useState('');
  const [people, setPeople] = useState<Recipient[]>([]);
  const [byEmail, setByEmail] = useState(false);

  const history = useQuery({ queryKey: ['broadcasts'], queryFn: () => api.get<Broadcast[]>('/notifications/broadcasts') });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<Group[]>('/groups'), enabled: target === 'GROUP' });

  const send = useAction(
    () =>
      api.post<{ recipients: number; emails: number }>('/notifications/broadcasts', {
        title: title.trim(),
        body: body.trim(),
        link: link || undefined,
        target,
        groupId: target === 'GROUP' ? groupId : undefined,
        userIds: target === 'USERS' ? people.map((p) => p.id) : undefined,
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
      },
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast('Titre obligatoire.');
    if (!body.trim()) return toast('Message obligatoire.');
    if (target === 'GROUP' && !groupId) return toast('Choisissez le groupe.');
    if (target === 'USERS' && !people.length) return toast('Choisissez au moins une personne.');
    send.mutate();
  };

  return (
    <>
      <PageHeader title="Envoyer une notification" subtitle="Découvrez les messages envoyés par le club et écrivez-en un nouveau." />
      <Section title="Nouveau message">
        <Card className="max-w-[760px]">
          <FormGrid onSubmit={submit} noValidate>
            <SelectField label="Destinataires *" value={target} onChange={(e) => setTarget(e.target.value as BroadcastTarget)}>
              {TARGETS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </SelectField>
            {target === 'GROUP' ? (
              <SelectField label="Groupe *" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">— Choisir —</option>
                {groups.data?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.members.length} joueur{g.members.length > 1 ? 's' : ''})
                  </option>
                ))}
              </SelectField>
            ) : (
              <SelectField label="Écran à ouvrir (facultatif)" value={link} onChange={(e) => setLink(e.target.value)}>
                {LINKS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </SelectField>
            )}
            {target === 'USERS' && <RecipientPicker value={people} onChange={setPeople} />}
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
            <CardGrid>
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
