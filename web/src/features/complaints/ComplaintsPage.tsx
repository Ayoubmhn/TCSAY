import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMe } from '../../auth/AuthContext';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { Card, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { SelectField, TextArea, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Segmented } from '../../components/ui/Segmented';
import { useToast } from '../../components/ui/Toast';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { resizedPhoto } from '../../lib/photo';
import { CATEGORIES, KINDS, STATUS_TONE, type Complaint, type ComplaintCategory, type ComplaintKind } from './types';

/** Carte d'une réclamation (liste de l'auteur ou des responsables). */
export function ComplaintCard({ c, to }: { c: Complaint; to: string }) {
  return (
    <Card>
      <CardRow>
        <h3>
          <Link to={to} className="hover:underline">
            n° {c.number} · {c.subject}
          </Link>
        </h3>
        <Pill tone={STATUS_TONE[c.status]}>{c.statusLabel}</Pill>
      </CardRow>
      <Pills>
        <Pill tone={c.kind === 'URGENT' ? 'r' : 's'}>{c.kindLabel}</Pill>
        <Pill tone="s">{c.categoryLabel}</Pill>
        <Pill tone="b">{formatDateTime(c.createdAt)}</Pill>
        {c.author && <Pill tone="g">{c.author.name}</Pill>}
        {c.player && <Pill tone="g" className="card-text">{c.player.name}</Pill>}
        {c.late && <Pill tone="r">Sans réponse depuis plus de 72 h</Pill>}
        {c.messages > 0 && <Pill tone="b" className="card-text">{c.messages} message(s)</Pill>}
        {c.satisfied === true && <Pill tone="g">👍 Satisfait</Pill>}
        {c.satisfied === false && <Pill tone="r">👎 Non satisfait</Pill>}
      </Pills>
      <CardText>{c.body.length > 160 ? `${c.body.slice(0, 160)}…` : c.body}</CardText>
      <div className="mt-auto flex justify-end">
        <ActionIcon kind="open" primary to={to} label="Ouvrir la réclamation" />
      </div>
    </Card>
  );
}

type Target = { id: string; name: string; role: string };

/** Nouvelle réclamation : type, catégorie, objet, description, enfant concerné, personne visée, photo. */
function NewComplaint({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const [kind, setKind] = useState<ComplaintKind>('COMPLAINT');
  const [category, setCategory] = useState<ComplaintCategory>('OTHER');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const targets = useQuery({ queryKey: ['complaint-targets', q], queryFn: () => api.get<Target[]>('/complaints/targets', { q }), enabled: q.trim().length >= 2 });
  const kids = me.role === 'PARENT' ? me.players : [];

  const send = async () => {
    if (!subject.trim() || !body.trim()) return toast('Indiquez l’objet et décrivez votre demande.');
    setBusy(true);
    try {
      const c = await api.post<Complaint>('/complaints', {
        kind,
        category,
        subject: subject.trim(),
        body: body.trim(),
        playerId: playerId || undefined,
        targetUserId: target?.id,
      });
      if (photo) await api.upload(`/complaints/${c.id}/photo`, await resizedPhoto(photo)).catch((e) => toast(`Envoyée, mais photo refusée : ${errorMessage(e)}`));
      toast(kind === 'URGENT' ? 'Signalement envoyé : le président est prévenu.' : 'Envoyée : vous serez prévenu de la réponse.');
      navigate(`/reclamations/${c.id}`);
    } catch (e) {
      toast(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="lg"
      title="Nouvelle réclamation ou suggestion"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={() => void send()} disabled={busy}>
            Envoyer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented label="Type" value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        <CardText keep>{KINDS.find((k) => k.value === kind)?.hint}</CardText>
        <div className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-2">
          <SelectField label="Catégorie" value={category} onChange={(e) => setCategory(e.target.value as ComplaintCategory)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </SelectField>
          {kids.length > 0 && (
            <SelectField label="Enfant concerné (facultatif)" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
              <option value="">—</option>
              {kids.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.firstName} {k.lastName}
                </option>
              ))}
            </SelectField>
          )}
        </div>
        <TextField label="Objet" value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} placeholder="ex. Éclairage du court 3 en panne" />
        <TextArea label="Description" value={body} maxLength={3000} rows={5} onChange={(e) => setBody(e.target.value)} placeholder="Que s’est-il passé ? Quand ? Qu’attendez-vous du club ?" />
        <div className="flex flex-col gap-1.5">
          {target ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-mut">Personne concernée</span>
              <button type="button" onClick={() => setTarget(null)} aria-label="Retirer la personne concernée">
                <Pill tone="s">{target.name} ✕</Pill>
              </button>
            </div>
          ) : (
            <TextField label="Personne concernée (facultatif : entraîneur, personnel)" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="2 lettres au moins" />
          )}
          {!target && q.trim().length >= 2 && (
            <div className="flex max-h-[180px] flex-col gap-1 overflow-y-auto" role="listbox" aria-label="Personnes">
              {targets.data?.length === 0 && <span className="px-1 text-[13px] text-mut">Personne trouvée.</span>}
              {targets.data?.map((t) => (
                <button key={t.id} type="button" role="option" aria-selected={false} onClick={() => (setTarget(t), setQ(''))} className="flex justify-between rounded-[14px] bg-fld px-3 py-2 text-start text-sm hover:bg-btn">
                  <span>{t.name}</span>
                  <span className="text-xs text-mut">{t.role}</span>
                </button>
              ))}
            </div>
          )}
          {target && <CardText keep>Cette personne ne verra jamais votre réclamation.</CardText>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => input.current?.click()}>{photo ? 'Changer la photo' : 'Joindre une photo (facultatif)'}</Button>
          {photo && <Pill tone="g">{photo.name}</Pill>}
          <input ref={input} type="file" accept="image/*" className="hidden" aria-label="Photo jointe" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </div>
        {category === 'BEHAVIOR' && <Note>Les réclamations « Comportement » ne sont lues que par le président.</Note>}
      </div>
    </Modal>
  );
}

/** Mes réclamations et suggestions (tous les acteurs). */
export function ComplaintsPage() {
  const q = useQuery({ queryKey: ['complaints', 'mine'], queryFn: () => api.get<Complaint[]>('/complaints/mine') });
  const [creating, setCreating] = useState(false);
  const [view, setView] = useViewMode('reclamations');
  return (
    <>
      <PageHeader
        title="Réclamations et suggestions"
        subtitle="Découvrez vos demandes au club et leurs réponses."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Nouvelle
            </Button>
          </div>
        }
      />
      <div className="mt-4">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {q.data?.length ? (
            <CardGrid list={view === 'list'}>
              {q.data.map((c) => (
                <ComplaintCard key={c.id} c={c} to={`/reclamations/${c.id}`} />
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucune réclamation pour l’instant.</EmptyState>
          )}
        </QueryState>
      </div>
      <div className="mt-4">
        <Note>La catégorie choisie envoie votre demande au bon responsable. Réponse visée sous 72 h ; vous êtes prévenu à chaque étape.</Note>
      </div>
      {creating && <NewComplaint onClose={() => setCreating(false)} />}
    </>
  );
}
