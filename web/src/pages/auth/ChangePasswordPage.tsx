import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { homeOf, useAuth } from '../../auth/AuthContext';
import { Brand } from '../../components/ui/Brand';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { TextField } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';

/** Changement obligatoire du mot de passe temporaire (mustChangePassword). */
export function ChangePasswordPage() {
  const { me, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [pending, setPending] = useState(false);

  if (!me) return <Navigate to="/connexion" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw1.length < 8) return toast('Le mot de passe doit contenir au moins 8 caractères.');
    if (pw1 !== pw2) return toast('Les deux mots de passe ne correspondent pas.');
    setPending(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: pw1 });
      await refresh();
      toast('Mot de passe enregistré. Bienvenue !');
      navigate(homeOf(me), { replace: true });
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
          <h1>{me.mustChangePassword ? 'Choisissez votre mot de passe' : 'Changer de mot de passe'}</h1>
          <p className="mt-1 text-mut">
            {me.mustChangePassword
              ? `Bonjour ${me.firstName}, vous utilisez un mot de passe temporaire reçu par email. Remplacez-le pour continuer.`
              : `Bonjour ${me.firstName}, choisissez un nouveau mot de passe.`}
          </p>
        </div>
        <Card className="gap-3">
          <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
            <TextField
              label={me.mustChangePassword ? 'Mot de passe temporaire' : 'Mot de passe actuel'}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <TextField
              label="Nouveau mot de passe (8 caractères minimum)"
              type="password"
              autoComplete="new-password"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
            />
            <TextField
              label="Confirmation"
              type="password"
              autoComplete="new-password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
            <Button variant="primary" type="submit" disabled={pending}>
              Enregistrer et continuer
            </Button>
          </form>
        </Card>
        <button type="button" onClick={logout} className="self-start text-sm text-mut underline-offset-4 hover:underline">
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
