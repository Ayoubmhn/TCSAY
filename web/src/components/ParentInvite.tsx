import { useState } from 'react';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useAction } from '../lib/useAction';
import { Button } from './ui/Button';
import { Card, CardRow, CardText, EmptyState } from './ui/Card';
import { Modal } from './ui/Modal';
import { Note } from './ui/Note';
import { Pill, Pills } from './ui/Pill';
import { useToast } from './ui/Toast';

/** Lien d'invitation préparé par l'API (le jeton n'est rendu qu'une fois). */
export type Invite = { parentId: string; name: string; firstName: string; phone: string | null; children: string[]; token: string; expiresAt: string };

export const inviteUrl = (i: Invite) => `${window.location.origin}/bienvenue/${i.token}`;

/** Numéro pour WhatsApp (chiffres, indicatif 216 ajouté aux numéros tunisiens à 8 chiffres). */
export function waNumber(phone: string | null): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  d = d.replace(/\D/g, '');
  if (/^\d{8}$/.test(d)) d = `216${d}`;
  return d.length >= 8 ? d : null;
}

export function inviteMessage(i: Invite): string {
  const kids = i.children.length ? ` pour suivre ${i.children.join(', ')}` : '';
  return `Bonjour ${i.firstName}, le Tennis Club de Sayada vous invite à activer votre compte TCSAY${kids} (séances, paiements, notifications). Ouvrez ce lien personnel, valable jusqu'au ${formatDate(i.expiresAt)} : ${inviteUrl(i)}`;
}

/** Boutons d'envoi : WhatsApp (application ou web), SMS, copie du message. */
function SendButtons({ invite }: { invite: Invite }) {
  const toast = useToast();
  const wa = waNumber(invite.phone);
  const text = encodeURIComponent(inviteMessage(invite));
  const copy = async () => {
    const text = inviteMessage(invite);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Application mobile (vue web) ou navigateur ancien : copie par une zone de texte temporaire.
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      if (!ok) return toast('Copie impossible : sélectionnez le lien à la main.');
    }
    toast('Message copié : collez-le dans WhatsApp ou un SMS.');
  };
  return (
    <div className="flex flex-wrap gap-2">
      {wa ? (
        <a className="inline-flex items-center rounded-full bg-pri px-4 py-2 text-sm font-semibold text-white" href={`https://wa.me/${wa}?text=${text}`} target="_blank" rel="noreferrer">
          WhatsApp
        </a>
      ) : (
        <Pill tone="r">Téléphone manquant</Pill>
      )}
      {invite.phone && (
        <a className="inline-flex items-center rounded-full bg-btn px-4 py-2 text-sm font-medium text-fg" href={`sms:${invite.phone.replace(/\s/g, '')}?body=${text}`}>
          SMS
        </a>
      )}
      <Button onClick={() => void copy()}>Copier</Button>
    </div>
  );
}

/** Invitation d'un parent : nouveau lien, puis envoi depuis le téléphone ou l'ordinateur du club. */
export function InviteModal({ parent, onClose }: { parent?: { id: string; name: string }; onClose: () => void }) {
  const [invite, setInvite] = useState<Invite>();
  const create = useAction(() => api.post<Invite>(`/parents/${parent!.id}/invitation`), {
    invalidate: [['parents']],
    success: 'Lien d’invitation prêt.',
    onSuccess: setInvite,
  });
  const close = () => {
    setInvite(undefined);
    onClose();
  };
  return (
    <Modal open={Boolean(parent)} title={`Inviter ${parent?.name ?? ''}`} onClose={close}>
      <div className="flex flex-col gap-3">
        <Note>
          Le parent reçoit un lien personnel (14 jours, une seule utilisation) : il saisit son email (vérifié par un code), son
          téléphone, sa CIN et son mot de passe. Un nouveau lien remplace l’ancien.
        </Note>
        {!invite ? (
          <div>
            <Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>
              Préparer le lien
            </Button>
          </div>
        ) : (
          <>
            <CardText keep>
              <span className="break-all">{inviteUrl(invite)}</span>
            </CardText>
            <SendButtons invite={invite} />
          </>
        )}
      </div>
    </Modal>
  );
}

/** Invitations groupées : parents sans email réel ou jamais connectés, un bouton d'envoi par parent. */
export function BulkInviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [list, setList] = useState<Invite[]>();
  const [done, setDone] = useState<Set<string>>(new Set());
  const create = useAction(() => api.post<Invite[]>('/parents/invitations', {}), {
    invalidate: [['parents']],
    success: (r) => (r.length ? `${r.length} lien(s) préparé(s).` : 'Tous les parents ont déjà un email et se sont connectés.'),
    onSuccess: setList,
  });
  const close = () => {
    setList(undefined);
    setDone(new Set());
    onClose();
  };
  return (
    <Modal open={open} size="lg" title="Inviter les parents" onClose={close}>
      <div className="flex flex-col gap-3">
        <Note>
          Concerne les parents sans email réel ou qui ne se sont jamais connectés. Chaque préparation crée un nouveau lien et
          désactive l’ancien : envoyez ensuite les messages un par un (WhatsApp s’ouvre avec le message prêt).
        </Note>
        {!list ? (
          <div>
            <Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>
              Préparer les liens
            </Button>
          </div>
        ) : list.length === 0 ? (
          <EmptyState>Aucun parent à inviter.</EmptyState>
        ) : (
          <>
            <Pills>
              <Pill tone="b">{list.length} parent(s)</Pill>
              <Pill tone="g">{done.size} envoyé(s)</Pill>
            </Pills>
            <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto pe-1">
              {list.map((i) => (
                <Card key={i.parentId} className="gap-2 p-3.5" onClickCapture={(e) => (e.target as HTMLElement).closest('a,button') && setDone((d) => new Set(d).add(i.parentId))}>
                  <CardRow>
                    <h3 className="text-[15px]">{i.name}</h3>
                    {done.has(i.parentId) ? <Pill tone="g">Envoyé</Pill> : <Pill tone="s">{i.phone ?? 'Sans téléphone'}</Pill>}
                  </CardRow>
                  {i.children.length > 0 && <CardText keep>{i.children.join(', ')}</CardText>}
                  <SendButtons invite={i} />
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
