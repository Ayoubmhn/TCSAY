import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, errorMessage, getSpace, setPermissionsCode } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { TextField } from './ui/Field';
import { QueryState } from './ui/Loading';
import { Note } from './ui/Note';
import { PageHeader } from './ui/PageHeader';
import { useToast } from './ui/Toast';

/**
 * Accès au module Autorisations protégé par un code (4 à 8 chiffres) choisi par le président.
 * Première visite : création du code (avec le mot de passe du compte). Ensuite : saisie du code à chaque visite ;
 * le code reste en mémoire seulement le temps de la page. L'API le vérifie à chaque appel (en-tête X-Code-Autorisations).
 */
export function PermissionsGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['permissions-code'], queryFn: () => api.get<{ hasCode: boolean }>('/permissions/code-status') });
  const [unlocked, setUnlocked] = useState(false);
  const [mode, setMode] = useState<'unlock' | 'set'>('unlock');
  const [code, setCode] = useState('');
  const [code2, setCode2] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => () => setPermissionsCode(null), []); // en quittant la page : on oublie le code

  if (getSpace() !== 'admin') {
    return <Note>Ouvrez l’espace administration (menu de votre compte) pour gérer les autorisations.</Note>;
  }

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setPermissionsCode(code.trim());
    try {
      await api.get('/permissions');
      setUnlocked(true);
      setCode('');
      void qc.invalidateQueries({ queryKey: ['permissions'] });
      void qc.invalidateQueries({ queryKey: ['permission-users'] });
    } catch (err) {
      setPermissionsCode(null);
      toast(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(code.trim())) return toast(t('Le code contient 4 à 8 chiffres.'));
    if (code !== code2) return toast(t('Les deux codes ne correspondent pas.'));
    setPending(true);
    try {
      await api.post('/permissions/code', { password, code: code.trim() });
      toast(t('Code des autorisations enregistré.'));
      setPermissionsCode(code.trim());
      setUnlocked(true);
      setCode('');
      setCode2('');
      setPassword('');
      void qc.invalidateQueries({ queryKey: ['permissions-code'] });
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (unlocked) {
    return (
      <>
        {children}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={() => (setPermissionsCode(null), setUnlocked(false))}>Verrouiller</Button>
          <Button onClick={() => (setUnlocked(false), setMode('set'))}>Changer le code</Button>
        </div>
      </>
    );
  }

  const creating = status.data && !status.data.hasCode;
  return (
    <>
      <PageHeader title="Autorisations" subtitle="Découvrez les droits de chaque rôle : module protégé par le code du président." />
      <QueryState isPending={status.isPending} error={status.error} refetch={status.refetch}>
        <Card className="mt-4 max-w-[460px]">
          {creating || mode === 'set' ? (
            <form className="flex flex-col gap-3" onSubmit={save} noValidate>
              <h3>{creating ? 'Créer le code des autorisations' : 'Changer le code des autorisations'}</h3>
              <TextField label="Mot de passe de votre compte" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <TextField label="Nouveau code (4 à 8 chiffres)" type="password" inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
              <TextField label="Confirmation du code" type="password" inputMode="numeric" autoComplete="off" value={code2} onChange={(e) => setCode2(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" type="submit" disabled={pending}>
                  Enregistrer le code
                </Button>
                {!creating && (
                  <Button type="button" onClick={() => setMode('unlock')}>
                    Annuler
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <form className="flex flex-col gap-3" onSubmit={unlock} noValidate>
              <h3>Saisir le code des autorisations</h3>
              <TextField label="Code" type="password" inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" type="submit" disabled={pending || !code.trim()}>
                  Ouvrir
                </Button>
                <Button type="button" onClick={() => setMode('set')}>
                  Code oublié ? Le remplacer
                </Button>
              </div>
            </form>
          )}
        </Card>
      </QueryState>
      <Note>
        Le code n’est jamais affiché ni enregistré en clair ; 5 erreurs bloquent l’accès 15 minutes. Code oublié : le président le
        remplace avec le mot de passe de son compte.
      </Note>
    </>
  );
}
