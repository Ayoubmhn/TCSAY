import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { TextArea } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../lib/api';
import { STATUS, useChangeSeasonStatus, type Season, type SeasonAction } from './api';

const TEXTS: Record<SeasonAction['kind'], { title: string; text: string; cta: string; done: string }> = {
  activate: {
    title: 'Activer la saison',
    text: 'Elle deviendra la saison en cours : inscriptions et paiements ouverts. Une seule saison peut être active (R2).',
    cta: 'Activer',
    done: 'Saison activée.',
  },
  close: {
    title: 'Clôturer la saison',
    text: 'Elle sera verrouillée (R1). Aucune modification ne sera possible sans réouverture motivée.',
    cta: 'Clôturer',
    done: 'Saison clôturée.',
  },
  reopen: {
    title: 'Rouvrir la saison',
    text: 'La réouverture est tracée dans le journal d’audit (R1).',
    cta: 'Rouvrir',
    done: 'Saison rouverte. Motif enregistré.',
  },
};

type Props = { season?: Season; action?: SeasonAction; onClose: () => void };

/** Confirmation d'un changement de statut (confirmBox du prototype), motif obligatoire pour une réouverture. */
export function SeasonStatusModal({ season, action, onClose }: Props) {
  const toast = useToast();
  const change = useChangeSeasonStatus();
  const [motif, setMotif] = useState('');
  const open = Boolean(season && action);

  useEffect(() => {
    if (open) setMotif('');
  }, [open]);

  if (!season || !action) return null;
  const t = TEXTS[action.kind];
  const withMotif = action.kind === 'reopen';

  const confirm = async () => {
    if (withMotif && !motif.trim()) {
      toast('Le motif est obligatoire.');
      return;
    }
    try {
      await change.mutateAsync({
        id: season.id,
        status: action.target,
        version: season.version,
        reason: motif.trim() || undefined,
      });
      toast(action.kind === 'reopen' ? `${t.done} Statut : ${STATUS[action.target].label.toLowerCase()}.` : t.done);
      onClose();
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      title={`${t.title} ${season.label} ?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={confirm} disabled={change.isPending}>
            {t.cta}
          </Button>
        </>
      }
    >
      <p className="m-0 text-mut">{t.text}</p>
      {withMotif && (
        <TextArea label="Motif (obligatoire)" value={motif} maxLength={500} onChange={(e) => setMotif(e.target.value)} />
      )}
    </Modal>
  );
}
