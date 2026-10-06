import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { TextArea } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../lib/api';
import { STATUS_LABEL, isReopening, useChangeSeasonStatus, type Season, type SeasonStatus } from './api';

const ACTION_TEXT: Record<SeasonStatus, string> = {
  ACTIVE: 'Activer',
  CLOSED: 'Clôturer',
  HISTORICAL: 'Passer en historique',
  DRAFT: 'Repasser en brouillon',
};

const CONSEQUENCE: Record<SeasonStatus, string> = {
  ACTIVE: 'Elle deviendra la saison en cours. Une seule saison peut être active.',
  CLOSED: 'Elle sera verrouillée : plus aucune modification sans réouverture motivée.',
  HISTORICAL: 'Elle sera verrouillée et réservée à l’historique du club.',
  DRAFT: 'Elle redeviendra modifiable.',
};

export function statusActionLabel(from: SeasonStatus, to: SeasonStatus): string {
  return isReopening(from, to) ? (to === 'ACTIVE' ? 'Rouvrir' : 'Rouvrir en brouillon') : ACTION_TEXT[to];
}

type Props = { season?: Season; target?: SeasonStatus; onClose: () => void };

/** Confirmation d'un changement de statut ; motif obligatoire en cas de réouverture (R1). */
export function SeasonStatusModal({ season, target, onClose }: Props) {
  const toast = useToast();
  const change = useChangeSeasonStatus();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const open = Boolean(season && target);
  const needsReason = Boolean(season && target && isReopening(season.status, target));

  useEffect(() => {
    if (open) {
      setReason('');
      setError(undefined);
    }
  }, [open]);

  if (!season || !target) return null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (needsReason && !reason.trim()) {
      setError('Motif obligatoire pour une réouverture');
      return;
    }
    try {
      await change.mutateAsync({
        id: season.id,
        status: target,
        version: season.version,
        reason: reason.trim() || undefined,
      });
      toast(`Saison ${season.label} : ${STATUS_LABEL[target].toLowerCase()}.`);
      onClose();
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      title={`${statusActionLabel(season.status, target)} la saison ${season.label} ?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="season-status-form" disabled={change.isPending}>
            Confirmer
          </Button>
        </>
      }
    >
      <form id="season-status-form" noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-mut">{CONSEQUENCE[target]}</p>
        {needsReason && (
          <TextArea
            label="Motif de réouverture"
            placeholder="Ex. correction des inscriptions de juin"
            value={reason}
            maxLength={500}
            error={error}
            onChange={(e) => {
              setReason(e.target.value);
              setError(undefined);
            }}
          />
        )}
      </form>
    </Modal>
  );
}
