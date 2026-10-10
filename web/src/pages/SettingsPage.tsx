import { useState, type FormEvent } from 'react';
import { ACTOR_LABEL, useAuth, useMe } from '../auth/AuthContext';
import { FederationCard } from '../components/FederationCard';
import { Button } from '../components/ui/Button';
import { Card, CardText } from '../components/ui/Card';
import { TextField } from '../components/ui/Field';
import { KeyValue } from '../components/ui/KeyValue';
import { PageHeader } from '../components/ui/PageHeader';
import { Section } from '../components/ui/Section';
import { Segmented } from '../components/ui/Segmented';
import { setTheme, useTheme, type Theme } from '../components/ui/ThemeToggle';
import { useToast } from '../components/ui/Toast';
import { api } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import { LANGS, useI18n, type Lang } from '../lib/i18n';
import { useAction } from '../lib/useAction';


/**
 * Paramètres (tous les rôles) : informations du compte en lecture seule (modifiables par le club seulement),
 * changement de mot de passe, langue (FR / EN / AR, l'arabe passe de droite à gauche) et thème.
 */
export function SettingsPage() {
  const me = useMe();
  const { refresh } = useAuth();
  const { lang, setLang, t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');

  const change = useAction(() => api.post('/auth/change-password', { currentPassword: current, newPassword: pw1 }), {
    success: t('Mot de passe enregistré.'),
    onSuccess: () => {
      setCurrent('');
      setPw1('');
      setPw2('');
      void refresh();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!current) return toast(t('Saisissez votre mot de passe actuel.'));
    if (pw1.length < 8) return toast(t('Le mot de passe doit contenir au moins 8 caractères.'));
    if (pw1 !== pw2) return toast(t('Les deux mots de passe ne correspondent pas.'));
    change.mutate();
  };

  return (
    <>
      <PageHeader title="Paramètres" subtitle="Gérez votre compte, votre mot de passe et vos préférences." />
      <div className="grid grid-cols-1 items-start gap-x-6 min-[1001px]:grid-cols-2">
        <div>
          <Section title="Mon compte">
            <Card>
              <div>
                <KeyValue label="Nom">
                  {me.firstName} {me.lastName}
                </KeyValue>
                <KeyValue label="Rôles">{me.roles.map((r) => t(ACTOR_LABEL[r])).join(', ')}</KeyValue>
                <KeyValue label="Identifiant">{me.email ?? me.cin ?? '—'}</KeyValue>
                <KeyValue label="Email">{me.email ?? '—'}</KeyValue>
                <KeyValue label="Téléphone">{me.phone ?? '—'}</KeyValue>
                <KeyValue label="CIN">{me.cin ?? '—'}</KeyValue>
                <KeyValue label="Compte créé le">{formatDate(me.createdAt)}</KeyValue>
                <KeyValue label="Dernière connexion">{me.lastLoginAt ? formatDateTime(me.lastLoginAt) : '—'}</KeyValue>
              </div>
              <CardText>{t('Informations personnelles modifiables par le club seulement.')}</CardText>
            </Card>
          </Section>
          <Section title="Compte fédération (IJIN)">
            <FederationCard />
          </Section>
        </div>

        <div>
          <Section title="Mot de passe">
            <Card>
              <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
                <TextField label="Mot de passe actuel" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
                <TextField
                  label="Nouveau mot de passe (8 caractères minimum)"
                  type="password"
                  autoComplete="new-password"
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                />
                <TextField label="Confirmation" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
                <Button variant="primary" type="submit" disabled={change.isPending}>
                  Changer le mot de passe
                </Button>
              </form>
            </Card>
          </Section>

          <Section title="Préférences">
            <Card>
              <span className="text-xs font-medium text-mut">{t('Langue')}</span>
              <Segmented<Lang> label="Langue" options={LANGS} value={lang} onChange={setLang} />
              <span className="mt-1.5 text-xs font-medium text-mut">{t('Thème')}</span>
              <Segmented<Theme>
                label="Thème"
                options={[
                  { value: 'light', label: 'Clair' },
                  { value: 'dark', label: 'Sombre' },
                ]}
                value={theme}
                onChange={setTheme}
              />
              <CardText>{t('Préférences enregistrées sur cet appareil.')}</CardText>
            </Card>
          </Section>
        </div>
      </div>
    </>
  );
}
