import { Link } from 'react-router';
import { useState, type FormEvent } from 'react';
import { ACTOR_LABEL, useAuth, useMe } from '../auth/AuthContext';
import { FederationCard } from '../components/FederationCard';
import { KidsFederation } from '../components/KidsFederation';
import { InstallApp } from '../components/InstallApp';
import { NativePushSettings } from '../components/NativePushSettings';
import { PushSettings } from '../components/PushSettings';
import { StorageSettings } from '../components/StorageSettings';
import { isInApp } from '../lib/pwa';
import { Button } from '../components/ui/Button';
import { Card, CardText } from '../components/ui/Card';
import { TextField } from '../components/ui/Field';
import { KeyValue } from '../components/ui/KeyValue';
import { PageHeader } from '../components/ui/PageHeader';
import { ForgotPasswordModal } from '../components/ForgotPassword';
import { Section } from '../components/ui/Section';
import { PhotoEditor } from '../components/PhotoEditor';
import { PhotoConsent } from '../components/PhotoConsent';
import { Segmented } from '../components/ui/Segmented';
import { setTheme, useTheme, type Theme } from '../components/ui/ThemeToggle';
import { useToast } from '../components/ui/Toast';
import { changePassword, passwordHint } from '../lib/api';
import { Note } from '../components/ui/Note';
import { formatDate, formatDateTime } from '../lib/format';
import { LANGS, useI18n, type Lang } from '../lib/i18n';
import { useAction } from '../lib/useAction';


/**
 * Paramètres (tous les rôles) : informations du compte en lecture seule (modifiables par le club seulement),
 * changement de mot de passe, langue (FR / EN / AR, l'arabe passe de droite à gauche) et thème.
 */
export function SettingsPage() {
  const [forgot, setForgot] = useState(false);
  const me = useMe();
  const { refresh } = useAuth();
  const { lang, setLang, t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');

  const change = useAction(() => changePassword(current, pw1), {
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
    if (!current && !me.temporaryPassword) return toast(t('Saisissez votre mot de passe actuel.'));
    const hint = passwordHint(pw1);
    if (hint) return toast(t(hint));
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
              <PhotoEditor first={me.firstName} last={me.lastName} photo={me.photoUrl} path="/photos/me" />
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
          {(me.role === 'PARENT' || me.role === 'PLAYER') && (
            <Section title="Autorisation photo">
              <PhotoConsent />
            </Section>
          )}
          {me.role === 'PARENT' && me.players.length > 0 && (
            <Section title="Photos de mes enfants">
              <Card className="gap-4">
                {me.players.map((p) => (
                  <div key={p.id} className="flex flex-col gap-1.5">
                    <b className="text-[15px] font-medium">
                      {p.firstName} {p.lastName}
                    </b>
                    <PhotoEditor first={p.firstName} last={p.lastName} photo={p.photoUrl} path={`/photos/players/${p.id}`} hint="Visible de l’entraîneur (feuille de présence) et du club." />
                  </div>
                ))}
              </Card>
            </Section>
          )}
          {me.permissions.includes('permissions.manage') && (
            <Section title="Autorisations">
              <Card>
                <CardText keep>{t('Droits de chaque rôle et rôles des comptes : module protégé par votre code de sécurité.')}</CardText>
                <div>
                  <Link to="/parametres/autorisations" className="inline-flex items-center rounded-full bg-pri px-[18px] py-[10px] text-sm font-semibold text-white">
                    {t('Ouvrir les autorisations')}
                  </Link>
                </div>
              </Card>
            </Section>
          )}
          <Section title="Compte fédération (IJIN)">
            <FederationCard />
            {me.roles.includes('PARENT') && <KidsFederation />}
          </Section>
        </div>

        <div>
          <Section title="Mot de passe">
            <Card>
              <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
                {me.temporaryPassword ? (
                  <Note>{t('Vous utilisez encore le mot de passe temporaire reçu par email : choisissez le vôtre ci-dessous.')}</Note>
                ) : (
                  <TextField label="Mot de passe actuel" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
                )}
                <TextField
                  label="Nouveau mot de passe (10 caractères, lettres et chiffres)"
                  type="password"
                  autoComplete="new-password"
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                />
                <TextField label="Confirmation" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
                <Button variant="primary" type="submit" disabled={change.isPending}>
                  Changer le mot de passe
                </Button>
                {me.email && !me.email.endsWith('@a-completer.invalid') && (
                  <button type="button" className="self-start text-sm font-medium text-pri hover:underline" onClick={() => setForgot(true)}>
                    {t('Mot de passe actuel oublié ? Recevoir un code par email')}
                  </button>
                )}
              </form>
              <ForgotPasswordModal open={forgot} email={me.email ?? ''} onClose={() => setForgot(false)} onDone={() => void refresh()} />
            </Card>
          </Section>

          {isInApp() ? (
            <Section title="Notifications du téléphone">
              <NativePushSettings />
            </Section>
          ) : (
            <Section title="Application mobile">
              <InstallApp />
              <PushSettings />
            </Section>
          )}

          <Section title="Stockage sur l’appareil">
            <StorageSettings />
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
              <CardText keep>
                {t('Version du site')} : <span className="tabular-nums">{__APP_VERSION__}</span>
              </CardText>
            </Card>
          </Section>
        </div>
      </div>
    </>
  );
}
