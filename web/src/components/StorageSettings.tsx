import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { clearCache } from '../lib/offline-cache';
import { mine } from '../lib/outbox';
import { Button } from './ui/Button';
import { Card, CardText } from './ui/Card';
import { Pill } from './ui/Pill';

const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`);

/**
 * Place prise sur l'appareil et « Vider le cache » : copies de l'application et lectures gardées hors connexion.
 * La session et les pointages en attente d'envoi ne sont jamais effacés.
 */
export function StorageSettings() {
  const { t } = useI18n();
  const [used, setUsed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const waiting = mine().length;

  useEffect(() => {
    void navigator.storage
      ?.estimate?.()
      .then((e) => setUsed(e.usage ?? null))
      .catch(() => undefined);
  }, []);

  const empty = async () => {
    setBusy(true);
    clearCache();
    try {
      if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    } catch {
      /* cache du navigateur indisponible */
    }
    window.location.reload();
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="b">{used === null ? t('Place utilisée inconnue') : `${t('Place utilisée')} : ${size(used)}`}</Pill>
        {waiting > 0 && <Pill tone="r">{`${waiting} ${t('pointage(s) en attente d’envoi')}`}</Pill>}
      </div>
      <CardText keep>
        {t('Copies de l’application et des dernières pages consultées, gardées pour ouvrir le site plus vite et sans réseau. Les vider libère de la place ; elles se recréent au fil des visites. Votre session reste ouverte.')}
      </CardText>
      {waiting > 0 && <CardText keep>{t('Envoyez d’abord les pointages en attente (avec du réseau) : ils ne sont jamais effacés.')}</CardText>}
      <div>
        <Button onClick={() => void empty()} disabled={busy}>
          {busy ? 'Nettoyage…' : 'Vider le cache'}
        </Button>
      </div>
    </Card>
  );
}
