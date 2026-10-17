import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Card, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { TextArea } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api, blobUrl } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useAction } from '../../lib/useAction';
import { STATUS_TONE, type ComplaintDetail, type ComplaintStatus } from './types';

const SPACE: Record<string, string> = { parent: 'Parent', player: 'Joueur', coach: 'Entraîneur', admin: 'Personnel' };

/** Photo jointe : chargée avec le jeton (jamais publique). */
function AttachedPhoto({ id }: { id: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let url: string | undefined;
    void blobUrl(`/complaints/${id}/photo`).then((u) => setSrc((url = u)), () => undefined);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return src ? <img src={src} alt="Photo jointe" className="max-h-[360px] w-auto max-w-full rounded-[18px] border-[1.5px] border-line object-contain" /> : null;
}

/** Fiche d'une réclamation : auteur (échanges, satisfaction) ou responsable (prise en charge, réponse, note interne). */
export function ComplaintPage({ admin = false }: { admin?: boolean }) {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['complaint', id], queryFn: () => api.get<ComplaintDetail>(`/complaints/${id}`) });
  const c = q.data;
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [closing, setClosing] = useState<ComplaintStatus | null>(null);
  const [answer, setAnswer] = useState('');
  const keys = [['complaint', id], ['complaints']];
  const send = useAction(() => api.post(`/complaints/${id}/messages`, { body: text.trim(), internal }), {
    invalidate: keys,
    success: (_r) => (internal ? 'Note interne ajoutée.' : 'Message envoyé.'),
    onSuccess: () => (setText(''), setInternal(false)),
  });
  const status = useAction((b: { status: ComplaintStatus; message?: string }) => api.post(`/complaints/${id}/status`, b), {
    invalidate: keys,
    success: 'Réclamation mise à jour : l’auteur est prévenu.',
    onSuccess: () => (setClosing(null), setAnswer('')),
  });
  const rate = useAction((satisfied: boolean) => api.post(`/complaints/${id}/satisfaction`, { satisfied }), { invalidate: keys, success: 'Merci pour votre avis.' });

  const back = admin ? '/admin/reclamations' : '/reclamations';
  const open = c && (c.status === 'NEW' || c.status === 'IN_PROGRESS');
  return (
    <>
      <Link to={back} className="text-sm font-medium text-mut hover:underline">
        ‹ Réclamations
      </Link>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {c && (
          <>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-[23px] font-semibold">
                n° {c.number} · {c.subject}
              </h1>
              <Pill tone={STATUS_TONE[c.status]}>{c.statusLabel}</Pill>
            </div>
            <Pills className="mt-3">
              <Pill tone={c.kind === 'URGENT' ? 'r' : 's'}>{c.kindLabel}</Pill>
              <Pill tone="s">{c.categoryLabel}</Pill>
              <Pill tone="b">{formatDateTime(c.createdAt)}</Pill>
              {c.author && (
                <Pill tone="g">
                  {c.author.name} · {SPACE[c.author.space] ?? c.author.space}
                </Pill>
              )}
              {c.player && <Pill tone="g">Enfant : {c.player.name}</Pill>}
              {c.target && <Pill tone="r">Personne concernée : {c.target.name}</Pill>}
              {c.assignee && <Pill tone="b">Suivi par {c.assignee}</Pill>}
              {c.late && <Pill tone="r">Sans réponse depuis plus de 72 h</Pill>}
            </Pills>

            <Section title="Demande">
              <Card className="max-w-[760px] gap-3">
                <p className="whitespace-pre-wrap">{c.body}</p>
                {c.hasPhoto && <AttachedPhoto id={c.id} />}
              </Card>
            </Section>

            {c.canHandle && open && (
              <div className="mt-4 flex flex-wrap gap-2">
                {c.status === 'NEW' && (
                  <Button onClick={() => status.mutate({ status: 'IN_PROGRESS' })} disabled={status.isPending}>
                    Prendre en charge
                  </Button>
                )}
                <Button variant="primary" onClick={() => setClosing('RESOLVED')}>
                  Résolue
                </Button>
                <Button variant="danger" onClick={() => setClosing('REJECTED')}>
                  Refuser
                </Button>
              </div>
            )}

            <Section title="Échanges">
              <div className="flex max-w-[760px] flex-col gap-2">
                {c.messages.length === 0 && <EmptyState>{c.canHandle ? 'Aucune réponse pour l’instant.' : 'Le club n’a pas encore répondu.'}</EmptyState>}
                {c.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex max-w-[92%] flex-col gap-1 rounded-[18px] px-4 py-3 ${m.internal ? 'self-stretch border-[1.5px] border-dashed border-line bg-card' : m.fromAuthor ? 'self-start bg-fld' : 'self-end bg-pb text-ink'}`}
                  >
                    <CardRow>
                      <b className="text-[13px]">{m.internal ? `Note interne · ${m.author}` : m.author}</b>
                      <span className="text-xs opacity-70">{formatDateTime(m.createdAt)}</span>
                    </CardRow>
                    <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                  </div>
                ))}
                {(open || c.canHandle) && (
                  <Card className="gap-2">
                    <TextArea label={c.canHandle ? 'Répondre à l’auteur' : 'Ajouter un message'} rows={3} maxLength={3000} value={text} onChange={(e) => setText(e.target.value)} />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {c.canHandle ? (
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Note interne (jamais montrée à l’auteur)
                        </label>
                      ) : (
                        <span />
                      )}
                      <Button variant="primary" onClick={() => send.mutate()} disabled={!text.trim() || send.isPending}>
                        Envoyer
                      </Button>
                    </div>
                  </Card>
                )}
              </div>
            </Section>

            {!c.canHandle && !open && (
              <Section title="Votre avis">
                <Card className="max-w-[760px] gap-2">
                  <CardText keep>{c.satisfied === null ? 'Êtes-vous satisfait de la réponse du club ?' : c.satisfied ? 'Merci : vous êtes satisfait.' : 'Merci : votre avis est transmis au responsable.'}</CardText>
                  <div className="flex gap-2">
                    <Button variant={c.satisfied === true ? 'primary' : 'secondary'} onClick={() => rate.mutate(true)} disabled={rate.isPending}>
                      👍 Oui
                    </Button>
                    <Button variant={c.satisfied === false ? 'danger' : 'secondary'} onClick={() => rate.mutate(false)} disabled={rate.isPending}>
                      👎 Non
                    </Button>
                  </div>
                </Card>
              </Section>
            )}
            {!c.canHandle && (
              <div className="mt-4 max-w-[760px]">
                <Note>{c.target ? 'La personne concernée ne voit pas votre réclamation. ' : ''}Vous êtes prévenu par notification à chaque réponse.</Note>
              </div>
            )}
          </>
        )}
      </QueryState>
      <Modal
        open={Boolean(closing)}
        title={closing === 'RESOLVED' ? 'Réclamation résolue' : 'Refuser la réclamation'}
        onClose={() => setClosing(null)}
        footer={
          <>
            <Button onClick={() => setClosing(null)}>Annuler</Button>
            <Button variant="primary" data-primary onClick={() => closing && status.mutate({ status: closing, message: answer.trim() })} disabled={!answer.trim() || status.isPending}>
              Envoyer la réponse
            </Button>
          </>
        }
      >
        <TextArea label="Réponse à l’auteur (obligatoire)" rows={4} maxLength={3000} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={closing === 'RESOLVED' ? 'ex. L’éclairage du court 3 a été réparé ce matin.' : 'ex. Le tarif est celui voté par le bureau pour la saison.'} />
      </Modal>
    </>
  );
}
