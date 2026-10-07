import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { TextArea } from './Field';
import { Modal } from './Modal';
import { useToast } from './Toast';

/** Confirmation (confirmBox du prototype) : texte, motif obligatoire éventuel, Annuler / action. */
export function ConfirmModal({
  open,
  title,
  text,
  cta,
  withMotif = false,
  pending = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  text: ReactNode;
  cta: string;
  withMotif?: boolean;
  pending?: boolean;
  onConfirm: (motif: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [motif, setMotif] = useState('');
  useEffect(() => {
    if (open) setMotif('');
  }, [open]);

  const confirm = () => {
    if (withMotif && !motif.trim()) {
      toast('Le motif est obligatoire.');
      return;
    }
    onConfirm(motif.trim());
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={confirm} disabled={pending}>
            {cta}
          </Button>
        </>
      }
    >
      <p className="m-0 text-mut">{text}</p>
      {withMotif && <TextArea label="Motif (obligatoire)" value={motif} maxLength={300} onChange={(e) => setMotif(e.target.value)} />}
    </Modal>
  );
}
