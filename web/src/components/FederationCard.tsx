import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { FederationAccount } from '../lib/types';
import { useAction } from '../lib/useAction';
import { Button } from './ui/Button';
import { Card, CardText } from './ui/Card';
import { TextField } from './ui/Field';
import { Pill } from './ui/Pill';

/**
 * Compte fédération (IJIN), facultatif : identifiant et mot de passe propres à chaque acteur.
 * Le mot de passe est chiffré côté serveur et n'est montré qu'à son propriétaire, sur demande.
 */
export function FederationCard() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['federation'], queryFn: () => api.get<FederationAccount>('/me/federation') });
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState<string>();
  useEffect(() => {
    if (q.data) setLogin(q.data.login ?? '');
  }, [q.data]);

  const save = useAction(
    () => api.put<FederationAccount>('/me/federation', { login: login.trim(), password: password ? password : undefined }),
    {
      invalidate: [['federation']],
      success: (r) => (r.login ? 'Compte IJIN enregistré.' : 'Compte IJIN retiré.'),
      onSuccess: () => {
        setPassword('');
        setShown(undefined);
      },
    },
  );
  const reveal = useAction(() => api.post<{ password: string }>('/me/federation/reveal'), { onSuccess: (r) => setShown(r.password) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Card>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <div className="flex flex-wrap items-center gap-2">
          {q.data?.login ? <Pill tone="g">Enregistré</Pill> : <Pill tone="s">Facultatif</Pill>}
          {q.data?.hasPassword && <Pill tone="b">Mot de passe enregistré</Pill>}
        </div>
        <TextField label="Identifiant IJIN" autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} />
        <TextField
          label={q.data?.hasPassword ? 'Nouveau mot de passe IJIN (vide = inchangé)' : 'Mot de passe IJIN'}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {shown !== undefined && (
          <div className="flex flex-wrap items-center gap-2 rounded-[18px] bg-fld px-4 py-2 text-sm">
            <span className="text-mut">{t('Mot de passe IJIN')} :</span>
            <b className="font-semibold">{shown}</b>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" type="submit" disabled={save.isPending}>
            Enregistrer
          </Button>
          {q.data?.hasPassword && (
            <Button onClick={() => (shown === undefined ? reveal.mutate() : setShown(undefined))} disabled={reveal.isPending}>
              {shown === undefined ? 'Afficher le mot de passe' : 'Masquer'}
            </Button>
          )}
        </div>
        <CardText>{t('Visible par vous seul, chiffré par le club. L’accès direct au site de la fédération viendra plus tard. Identifiant vide = compte retiré.')}</CardText>
      </form>
    </Card>
  );
}
