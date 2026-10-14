import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { api, errorMessage } from '../lib/api';
import { disablePush, enablePush, usePush } from '../lib/push';
import { Button } from './ui/Button';
import { Card, CardText } from './ui/Card';
import { Pill } from './ui/Pill';
import { useToast } from './ui/Toast';

/** Notifications push sur cet appareil : activer, désactiver, envoyer un essai. */
export function PushSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const { state, setState } = usePush();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (state === null) return null;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        {state === 'on' ? <Pill tone="g">Notifications activées</Pill> : state === 'denied' ? <Pill tone="r">Notifications bloquées</Pill> : <Pill tone="s">Notifications désactivées</Pill>}
      </div>
      {state === 'unsupported' && <CardText keep>{t('Ce navigateur ne reçoit pas les notifications push. Les notifications restent visibles dans la cloche.')}</CardText>}
      {state === 'ios-install' && <CardText keep>{t('Sur iPhone, ajoutez d’abord l’application à l’écran d’accueil, puis activez les notifications depuis l’application installée.')}</CardText>}
      {state === 'dev' && <CardText keep>{t('Les notifications push fonctionnent avec la version de production (npm run build), en HTTPS ou sur localhost.')}</CardText>}
      {state === 'denied' && <CardText keep>{t('Autorisez les notifications pour ce site dans les réglages du navigateur, puis revenez ici.')}</CardText>}
      {state === 'off' && (
        <>
          <CardText keep>{t('Recevez sur cet appareil les messages du club, rappels de paiement, séances et résultats de match, même application fermée.')}</CardText>
          <div>
            <Button variant="primary" disabled={busy} onClick={() => void run(async () => setState(await enablePush()))}>
              Activer les notifications
            </Button>
          </div>
        </>
      )}
      {state === 'on' && (
        <>
          <CardText keep>{t('Cet appareil reçoit les notifications de votre compte.')}</CardText>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.post('/push/test');
                  toast(t('Notification d’essai envoyée.'));
                })
              }
            >
              Envoyer un essai
            </Button>
            <Button disabled={busy} onClick={() => void run(async () => setState(await disablePush()))}>
              Désactiver
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
