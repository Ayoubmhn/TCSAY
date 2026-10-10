import { Button } from './ui/Button';
import { KeyValue } from './ui/KeyValue';
import { Modal } from './ui/Modal';
import { Note } from './ui/Note';
import type { Credentials } from '../lib/types';

/** Comptes créés sans email : identifiant (CIN) et mot de passe temporaire à remettre en main propre. */
export function CredentialsModal({ items, onClose }: { items: (Credentials & { name: string })[]; onClose: () => void }) {
  const shown = items.filter((c) => c.temporaryPassword);
  return (
    <Modal
      open={shown.length > 0}
      title="Identifiants à remettre"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          J’ai noté
        </Button>
      }
    >
      {shown.map((c) => (
        <div key={c.login} className="rounded-[18px] bg-fld px-4 py-2">
          <KeyValue label="Compte">{c.name}</KeyValue>
          <KeyValue label="Identifiant">{c.login}</KeyValue>
          <KeyValue label="Mot de passe temporaire">
            <b className="font-semibold tabular-nums">{c.temporaryPassword}</b>
          </KeyValue>
        </div>
      ))}
      <Note>Pas d’email : remettez ces identifiants en main propre. Le changement de mot de passe est obligatoire à la première connexion. Ils ne seront plus affichés.</Note>
    </Modal>
  );
}
