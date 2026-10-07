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

/** Comptes du seed de démonstration (affichés en développement seulement). */
const DEMO = [
  { label: 'Joueur', hint: 'Omar Trabelsi, adulte', email: 'omar.trabelsi@exemple.tn', password: 'temporaire' },
  { label: 'Parent', hint: 'Sana Ben Ali, 2 enfants', email: 'sana.benali@exemple.tn', password: 'temporaire' },
  { label: 'Coach', hint: 'Iheb, plusieurs groupes', email: 'iheb@exemple.tn', password: 'temporaire' },
  { label: 'Personnel', hint: 'Agent administratif', email: 'agent@tcsay.tn', password: 'temporaire' },
  { label: 'Administrateur', hint: 'Bureau du club', email: 'admin@tcsay.tn', password: 'admin1234' },
];

export function LoginPage() {
  const { me, login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);

  if (me) return <Navigate to={me.mustChangePassword ? '/mot-de-passe' : homeOf(me.role)} replace />;

  const submit = async (e?: FormEvent, credentials = { email, password }) => {
    e?.preventDefault();
    if (!credentials.email.trim() || !credentials.password) {
      toast('Saisissez votre identifiant et votre mot de passe.');
      return;
    }
    setPending(true);
    try {
      const profile = await login(credentials.email.trim(), credentials.password);
      navigate(profile.mustChangePassword ? '/mot-de-passe' : homeOf(profile.role), { replace: true });
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
        <div>
          <h1>Connexion</h1>
          <p className="mt-1 text-mut">Les comptes sont créés par l’administrateur du club.</p>
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

        {import.meta.env.DEV && (
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
                  className="flex flex-col gap-1 rounded-[24px] border-[1.5px] border-line bg-card p-4 text-left hover:border-pri"
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
