import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { askApp, registerNativePush, useNativePush } from '../lib/native-push';
import { Button } from './ui/Button';
import { Card, CardText } from './ui/Card';
import { Pill } from './ui/Pill';
import { useToast } from './ui/Toast';

/** Application mobile : état des notifications du téléphone, essai, réglages Android. */
export function NativePushSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const push = useNativePush();
  const [busy, setBusy] = useState(false);

  const test = async () => {
    setBusy(true);
    try {
      await registerNativePush();
      await api.post('/push/test');
      toast(t('Notification d’essai envoyée.'));
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!push) {
    return (
      <Card>
        <Pill tone="s">Notifications du téléphone</Pill>
        <CardText keep>{t('Mettez l’application à jour (nouvel APK) pour recevoir les notifications sur le téléphone. En attendant, elles restent dans la cloche.')}</CardText>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        {push.status === 'granted' && push.token ? (
          <Pill tone="g">Notifications activées</Pill>
        ) : push.status === 'denied' ? (
          <Pill tone="r">Notifications bloquées</Pill>
        ) : (
          <Pill tone="s">Notifications indisponibles</Pill>
        )}
      </div>
      {push.status === 'granted' && push.token && (
        <>
          <CardText keep>{t('Ce téléphone reçoit les notifications de votre compte, même application fermée.')}</CardText>
          <div>
            <Button variant="primary" disabled={busy} onClick={() => void test()}>
              Envoyer un essai
            </Button>
          </div>
        </>
      )}
      {push.status === 'denied' && (
        <>
          <CardText keep>{t('Autorisez les notifications de TCSAY dans les réglages du téléphone, puis revenez ici.')}</CardText>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => askApp('enable')}>
              Autoriser
            </Button>
            <Button onClick={() => askApp('settings')}>Ouvrir les réglages</Button>
          </div>
        </>
      )}
      {push.status === 'unavailable' && (
        <CardText keep>
          {t('Le service de notifications ne répond pas sur ce téléphone. Les notifications restent dans la cloche.')}
          {push.error ? ` (${push.error})` : ''}
        </CardText>
      )}
    </Card>
  );
}
