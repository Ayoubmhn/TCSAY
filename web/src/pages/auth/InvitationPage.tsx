import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { Brand } from '../../components/ui/Brand';
import { Button } from '../../components/ui/Button';
import { Card, EmptyState } from '../../components/ui/Card';
import { TextField } from '../../components/ui/Field';
import { Note } from '../../components/ui/Note';
import { Pill, Pills } from '../../components/ui/Pill';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage, passwordHint, setToken } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

type Invitation = { firstName: string; lastName: string; email: string | null; phone: string | null; cin: string | null; children: string[]; expiresAt: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CIN = /^[0-9A-Za-z]{6,12}$/;

/**
 * Lien d'invitation reçu par WhatsApp ou SMS (/bienvenue/:jeton) : le parent complète lui-même son email (vérifié par
 * un code), son téléphone, sa CIN et son mot de passe ; le compte est activé et la session ouverte.
 */
export function InvitationPage() {
  const { token = '' } = useParams();
  const { t } = useI18n();
  const toast = useToast();
  const inv = useQuery({ queryKey: ['invitation', token], queryFn: () => api.get<Invitation>(`/invitations/${token}`), retry: false });
  const [f, setF] = useState({ email: '', code: '', phone: '', cin: '', pw1: '', pw2: '' });
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  // Coordonnées déjà connues du club : proposées, modifiables.
  useEffect(() => {
    if (inv.data) setF((x) => ({ ...x, email: x.email || inv.data.email || '', phone: x.phone || inv.data.phone || '', cin: x.cin || inv.data.cin || '' }));
  }, [inv.data]);

  const email = f.email.trim().toLowerCase();
  const codeSent = sentTo !== null && sentTo === email;

  const sendCode = async () => {
    if (!EMAIL.test(email)) return toast(t('Saisissez une adresse email valide.'));
    setBusy(true);
    try {
      const r = await api.post<{ sentTo: string; minutes: number }>(`/invitations/${token}/email-code`, { email });
      setSentTo(r.sentTo);
      toast(`Code envoyé à ${r.sentTo} (valable ${r.minutes} minutes). Regardez aussi les spams.`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!codeSent) return toast(t('Recevez d’abord le code de vérification sur votre email.'));
    if (!/^\d{6}$/.test(f.code.trim())) return toast(t('Le code reçu par email contient 6 chiffres.'));
    if (!f.phone.trim()) return toast(t('Le téléphone est obligatoire.'));
    if (!CIN.test(f.cin.trim())) return toast(t('CIN obligatoire (6 à 12 caractères).'));
    const hint = passwordHint(f.pw1);
    if (hint) return toast(t(hint));
    if (f.pw1 !== f.pw2) return toast(t('Les deux mots de passe ne correspondent pas.'));
    setBusy(true);
    try {
      const r = await api.post<{ accessToken: string }>(`/invitations/${token}/complete`, {
        email,
        code: f.code.trim(),
        phone: f.phone.trim(),
        cin: f.cin.trim(),
        password: f.pw1,
      });
      setToken(r.accessToken);
      toast(t('Compte activé. Bienvenue au TCSAY !'));
      window.location.assign('/');
    } catch (err) {
      toast(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center px-4 py-6">
      <div className="flex w-full max-w-[480px] flex-col gap-[18px]">
        <div className="flex items-center justify-between gap-3">
          <Brand />
          <ThemeToggle />
        </div>
        {inv.isPending ? (
          <EmptyState>Chargement…</EmptyState>
        ) : inv.error || !inv.data ? (
          <Card className="gap-3">
            <h1 className="text-[23px]">{t('Lien d’invitation')}</h1>
            <Note>{errorMessage(inv.error)}</Note>
            <div>
              <Button onClick={() => window.location.assign('/connexion')}>Aller à la connexion</Button>
            </div>
          </Card>
        ) : (
          <>
            <div>
              <h1>{`Bienvenue ${inv.data.firstName} 👋`}</h1>
              <p className="mt-1 text-mut">
                {t('Le Tennis Club de Sayada vous invite à activer votre compte : séances, absences, paiements et notifications du club.')}
              </p>
            </div>
            {inv.data.children.length > 0 && (
              <Pills>
                {inv.data.children.map((c) => (
                  <Pill key={c} tone="g">
                    {c}
                  </Pill>
                ))}
              </Pills>
            )}
            <Card className="gap-3">
              <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
                <TextField label="Email (obligatoire)" type="email" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} />
                {!codeSent ? (
                  <Button type="button" disabled={busy} onClick={() => void sendCode()}>
                    Recevoir le code par email
                  </Button>
                ) : (
                  <>
                    <TextField
                      label={`Code reçu à ${sentTo} (6 chiffres)`}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={f.code}
                      onChange={set('code')}
                    />
                    <button type="button" className="self-start text-sm font-medium text-pri hover:underline" disabled={busy} onClick={() => void sendCode()}>
                      {t('Renvoyer le code')}
                    </button>
                  </>
                )}
                <TextField label="Téléphone" type="tel" autoComplete="tel" inputMode="tel" value={f.phone} onChange={set('phone')} />
                <TextField label="CIN" autoComplete="off" value={f.cin} onChange={set('cin')} />
                <TextField
                  label="Mot de passe (10 caractères, lettres et chiffres)"
                  type="password"
                  autoComplete="new-password"
                  value={f.pw1}
                  onChange={set('pw1')}
                />
                <TextField label="Confirmation" type="password" autoComplete="new-password" value={f.pw2} onChange={set('pw2')} />
                <Button variant="primary" type="submit" disabled={busy || !codeSent}>
                  Activer mon compte
                </Button>
              </form>
            </Card>
            <Note>
              {t('Ensuite, connectez-vous avec votre email ou votre CIN et ce mot de passe, sur le site ou dans l’application TCSAY.')}
            </Note>
          </>
        )}
      </div>
    </div>
  );
}
