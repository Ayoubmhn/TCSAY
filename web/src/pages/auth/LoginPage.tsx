import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { homeOf, useAuth } from '../../auth/AuthContext';
import { Brand } from '../../components/ui/Brand';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { TextField } from '../../components/ui/Field';
import { Pill } from '../../components/ui/Pill';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../lib/api';
import { LANGS, useI18n } from '../../lib/i18n';

/** Comptes du seed de démonstration (affichés en développement et sur la démo en ligne, VITE_DEMO=1). */
const DEMO = [
  { label: 'Joueur', hint: 'Omar Trabelsi, adulte', email: 'omar.trabelsi@exemple.tn', password: 'temporaire' },
  { label: 'Parent', hint: 'Sana Ben Ali, 2 enfants', email: 'sana.benali@exemple.tn', password: 'temporaire' },
  { label: 'Coach', hint: 'Iheb, plusieurs groupes', email: 'iheb@exemple.tn', password: 'temporaire' },
  { label: 'Agent administratif', hint: 'Paiements, salaires, comptes', email: 'agent@tcsay.tn', password: 'temporaire' },
  { label: 'Superviseur', hint: 'Statistiques seulement', email: 'superviseur@tcsay.tn', password: 'temporaire' },
  { label: 'Directeur technique', hint: 'Groupes, emploi du temps · aussi entraîneur', email: 'dt@tcsay.tn', password: 'temporaire' },
  { label: 'Président', hint: 'Tous les accès, autorisations', email: 'admin@tcsay.tn', password: 'admin1234' },
];

export function LoginPage() {
  const { me, login } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);

  if (me) return <Navigate to={me.mustChangePassword ? '/mot-de-passe' : homeOf(me)} replace />;

  const submit = async (e?: FormEvent, credentials = { email, password }) => {
    e?.preventDefault();
    if (!credentials.email.trim() || !credentials.password) {
      toast('Saisissez votre identifiant et votre mot de passe.');
      return;
    }
    setPending(true);
    try {
      const profile = await login(credentials.email.trim(), credentials.password);
      navigate(profile.mustChangePassword ? '/mot-de-passe' : homeOf(profile), { replace: true });
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center px-4 py-6">
      <div className="flex w-full max-w-[460px] flex-col gap-[18px]">
        <Brand />
        <LangSwitch />
        <div>
          <h1>{t('Connexion')}</h1>
          <p className="mt-1 text-mut">{t('Les comptes sont créés par l’administrateur du club.')}</p>
        </div>
        <Card className="gap-3">
          <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
            <TextField
              label="Identifiant (email ou CIN)"
              type="text"
              autoComplete="username"
              placeholder="prenom.nom@exemple.tn ou 09123456"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              label="Mot de passe"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button variant="primary" type="submit" disabled={pending}>
              Se connecter
            </Button>
          </form>
        </Card>

        {(import.meta.env.DEV || import.meta.env.VITE_DEMO === '1') && (
          <>
            <div>
              <h2>Comptes de démonstration</h2>
              <p className="mt-1 text-mut">Développement uniquement : données du seed.</p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  disabled={pending}
                  onClick={() => submit(undefined, d)}
                  className="flex flex-col gap-1 rounded-[24px] border-[1.5px] border-line bg-card p-4 text-start hover:border-pri"
                >
                  <b className="font-semibold">{d.label}</b>
                  <small className="text-[12.5px] text-mut">{d.hint}</small>
                  {d.password === 'temporaire' && <Pill tone="s" className="mt-1.5 self-start">1re connexion</Pill>}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs text-mut">
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

/** Choix de la langue avant connexion (FR / EN / AR). */
function LangSwitch() {
  const { lang, setLang } = useI18n();
  return (
    <div role="group" aria-label="Langue" className="flex gap-1.5">
      {LANGS.map((l) => (
        <button
          key={l.value}
          type="button"
          aria-pressed={lang === l.value}
          onClick={() => setLang(l.value)}
          className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium ${lang === l.value ? 'bg-toggle text-bg' : 'bg-btn text-fg'}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
