import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, passwordHint } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/Button';
import { TextField } from './ui/Field';
import { Modal } from './ui/Modal';
import { Note } from './ui/Note';
import { useToast } from './ui/Toast';

/**
 * Mot de passe oublié, en deux étapes : (1) email du compte → code à 6 chiffres envoyé par email ;
 * (2) code + nouveau mot de passe. Accessible depuis la connexion et depuis Paramètres (email prérempli).
 */
export function ForgotPasswordModal({ open, email: initial = '', onClose, onDone }: { open: boolean; email?: string; onClose: () => void; onDone?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState(initial);
  const [code, setCode] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) (setStep(1), setEmail(initial), setCode(''), setPw1(''), setPw2(''));
  }, [open, initial]);

  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toast(t('Saisissez l’email de votre compte.'));
    void run(async () => {
      const r = await api.post<{ message: string }>('/auth/forgot-password', { email: email.trim() });
      toast(r.message);
      setStep(2);
    });
  };

  const reset = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return toast(t('Le code reçu par email contient 6 chiffres.'));
    const hint = passwordHint(pw1);
    if (hint) return toast(t(hint));
    if (pw1 !== pw2) return toast(t('Les deux mots de passe ne correspondent pas.'));
    void run(async () => {
      await api.post('/auth/reset-password', { email: email.trim(), code: code.trim(), newPassword: pw1 });
      toast(t('Mot de passe changé : connectez-vous avec le nouveau.'));
      onDone?.();
      onClose();
    });
  };

  return (
    <Modal open={open} title="Mot de passe oublié" onClose={onClose}>
      {step === 1 ? (
        <form className="flex flex-col gap-3" onSubmit={send} noValidate>
          <TextField label="Email du compte" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom.nom@exemple.tn" />
          <Button variant="primary" type="submit" disabled={pending}>
            Recevoir un code par email
          </Button>
          <Note>Compte sans email (connexion par CIN) : demandez à l’administration du club de vous envoyer un nouveau mot de passe.</Note>
        </form>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={reset} noValidate>
          <TextField label="Code reçu par email (6 chiffres)" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          <TextField label="Nouveau mot de passe (10 caractères, lettres et chiffres)" type="password" autoComplete="new-password" value={pw1} onChange={(e) => setPw1(e.target.value)} />
          <TextField label="Confirmation" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" type="submit" disabled={pending}>
              Changer le mot de passe
            </Button>
            <Button type="button" onClick={() => send()} disabled={pending}>
              Renvoyer un code
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
