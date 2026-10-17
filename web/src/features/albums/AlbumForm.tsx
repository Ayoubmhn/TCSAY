import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMe } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { CardText } from '../../components/ui/Card';
import { SelectField, TextArea, TextField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { todayIso } from '../../lib/format';
import { useAction } from '../../lib/useAction';
import { AUDIENCE_HINT, KINDS, type AlbumAudience, type AlbumDetail, type AlbumKind, type Contexts } from './types';

type Person = { kind: 'user' | 'player'; id: string; name: string };
type People = { users: { id: string; name: string; roles: string[] }[]; players: { id: string; name: string; code: string | null }[] };

/** Création / modification d'un album : contexte (tournoi, événement, match, groupe), audience, personnes ajoutées. */
export function AlbumForm({ album, onClose }: { album?: AlbumDetail; onClose: () => void }) {
  const me = useMe();
  const navigate = useNavigate();
  const manager = me.role === 'ADMIN' && me.permissions.includes('albums.manage');
  const [title, setTitle] = useState(album?.title ?? '');
  const [description, setDescription] = useState(album?.description ?? '');
  const [kind, setKind] = useState<AlbumKind>(album?.kind ?? (manager ? 'TOURNAMENT' : 'GROUP'));
  const [contextId, setContextId] = useState(album?.contextId ?? '');
  const [audience, setAudience] = useState<AlbumAudience>(album?.audience ?? 'CONTEXT');
  const [date, setDate] = useState(album?.date ?? todayIso());
  const [people, setPeople] = useState<Person[]>(album?.members ?? []);
  const [q, setQ] = useState('');
  const contexts = useQuery({ queryKey: ['album-contexts'], queryFn: () => api.get<Contexts>('/albums/contexts') });
  const found = useQuery({ queryKey: ['album-people', q], queryFn: () => api.get<People>('/albums/people', { q }), enabled: q.trim().length >= 2 });
  const options =
    kind === 'TOURNAMENT' ? contexts.data?.tournaments : kind === 'MATCH' ? contexts.data?.matches : kind === 'GROUP' ? contexts.data?.groups : kind === 'EVENT' ? contexts.data?.events : [];
  useEffect(() => {
    if (kind !== 'FREE' && options?.length && !options.some((o) => o.id === contextId)) setContextId(options[0].id);
  }, [kind, options]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (kind === 'FREE' && audience === 'CONTEXT') setAudience('CUSTOM');
  }, [kind, audience]);

  const body = () => ({
    title: title.trim(),
    description: description.trim() || undefined,
    kind,
    audience,
    date,
    contextId: kind === 'FREE' ? undefined : contextId || undefined,
    userIds: people.filter((p) => p.kind === 'user').map((p) => p.id),
    playerIds: people.filter((p) => p.kind === 'player').map((p) => p.id),
    ...(album ? { version: album.version } : {}),
  });
  const save = useAction(() => (album ? api.patch(`/albums/${album.id}`, body()) : api.post<{ id: string }>('/albums', body())), {
    invalidate: [['albums'], ['album', album?.id]],
    success: album ? 'Album modifié.' : 'Album créé : ajoutez les photos.',
    onSuccess: (r) => {
      onClose();
      if (!album && r && typeof r === 'object' && 'id' in r) navigate(`/photos/${(r as { id: string }).id}`);
    },
  });
  const add = (p: Person) => {
    setPeople((list) => (list.some((x) => x.kind === p.kind && x.id === p.id) ? list : [...list, p]));
    setQ('');
  };

  return (
    <Modal
      open
      size="lg"
      title={album ? 'Modifier l’album' : 'Nouvel album photos'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={() => save.mutate()} disabled={!title.trim() || save.isPending}>
            {album ? 'Enregistrer' : 'Créer l’album'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-2">
        <TextField label="Titre" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Finale de l’Open d’automne" />
        <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <SelectField label="Album de" value={kind} onChange={(e) => setKind(e.target.value as AlbumKind)}>
          {KINDS.filter((k) => manager || !k.manager).map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </SelectField>
        {kind !== 'FREE' && (
          <SelectField label="Lequel ?" value={contextId} onChange={(e) => setContextId(e.target.value)}>
            {!options?.length && <option value="">Aucun disponible</option>}
            {options?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {o.date ? ` · ${o.date}` : ''}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField label="Qui voit l’album ?" value={audience} onChange={(e) => setAudience(e.target.value as AlbumAudience)}>
          {kind !== 'FREE' && <option value="CONTEXT">Personnes concernées</option>}
          {manager && <option value="EVERYONE">Tout le club</option>}
          <option value="CUSTOM">Seulement les personnes choisies</option>
        </SelectField>
        <div className="flex items-end">
          <CardText keep>
            {audience === 'EVERYONE' ? 'Tous les membres connectés du club.' : audience === 'CUSTOM' ? 'Seulement les personnes ajoutées ci-dessous.' : AUDIENCE_HINT[kind]}
          </CardText>
        </div>
        <div className="flex flex-col gap-1.5 min-[561px]:col-span-2">
          <TextField
            label="Ajouter des personnes (parent, joueur, entraîneur, arbitre…)"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="2 lettres au moins"
          />
          {q.trim().length >= 2 && (
            <div className="flex max-h-[200px] flex-col gap-1 overflow-y-auto" role="listbox" aria-label="Personnes">
              {found.data?.users.map((u) => (
                <button key={`u${u.id}`} type="button" role="option" aria-selected={false} onClick={() => add({ kind: 'user', id: u.id, name: u.name })} className="flex justify-between rounded-[14px] bg-fld px-3 py-2 text-start text-sm hover:bg-btn">
                  <span>{u.name}</span>
                  <span className="text-xs text-mut">Compte</span>
                </button>
              ))}
              {found.data?.players.map((p) => (
                <button key={`p${p.id}`} type="button" role="option" aria-selected={false} onClick={() => add({ kind: 'player', id: p.id, name: p.name })} className="flex justify-between rounded-[14px] bg-fld px-3 py-2 text-start text-sm hover:bg-btn">
                  <span>{p.name}</span>
                  <span className="text-xs text-mut">Joueur et sa famille</span>
                </button>
              ))}
              {found.data && !found.data.users.length && !found.data.players.length && <span className="px-1 text-[13px] text-mut">Personne trouvée.</span>}
            </div>
          )}
          {people.length > 0 && (
            <Pills>
              {people.map((p) => (
                <button key={p.kind + p.id} type="button" aria-label={`Retirer ${p.name}`} onClick={() => setPeople((l) => l.filter((x) => !(x.kind === p.kind && x.id === p.id)))}>
                  <Pill tone={p.kind === 'player' ? 'g' : 'b'}>{p.name} ✕</Pill>
                </button>
              ))}
            </Pills>
          )}
        </div>
        <div className="min-[561px]:col-span-2">
          <TextArea label="Description (facultatif)" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
