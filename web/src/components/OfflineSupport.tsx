import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useMe } from '../auth/AuthContext';
import { api } from '../lib/api';
import { addDays, todayIso } from '../lib/format';
import { isOffline, onNetwork } from '../lib/offline-cache';
import { dismissFailure, failures, flush, lastFlush, mine, onOutbox } from '../lib/outbox';
import type { CoachSession } from '../lib/types';
import { useToast } from './ui/Toast';

const useNetworkOffline = () => useSyncExternalStore(onNetwork, isOffline);
const useOutboxVersion = () => useSyncExternalStore(onOutbox, () => `${mine().length}|${failures().length}|${lastFlush()}`);

/**
 * Bandeau hors connexion : « Hors connexion · 3 pointages en attente d'envoi », envoi au retour du réseau,
 * pointages refusés par l'API (séance déjà corrigée, trop ancien…) signalés un par un.
 */
export function OfflineBanner() {
  const offline = useNetworkOffline();
  const version = useOutboxVersion();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const waiting = mine();
  const refused = failures();
  const sentAt = Number(version.split('|')[2]);

  // Envoi réussi : feuilles et séances relues depuis l'API.
  useEffect(() => {
    if (!sentAt) return;
    toast('✓ Pointages envoyés au club.');
    void queryClient.invalidateQueries({ queryKey: ['attendance'] });
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
  }, [sentAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!offline && !waiting.length && !refused.length) return null;
  return (
    <div className="no-print mb-4 flex flex-col gap-2" role="status" aria-live="polite">
      {(offline || waiting.length > 0) && (
        <div className={`flex flex-wrap items-center gap-2 rounded-[18px] px-4 py-2.5 text-sm text-ink ${offline ? 'bg-ps' : 'bg-pb'}`}>
          <b className="font-semibold">{offline ? 'Hors connexion' : 'Connexion retrouvée'}</b>
          <span className="flex-1">
            {waiting.length
              ? `${waiting.length} pointage${waiting.length > 1 ? 's' : ''} en attente d’envoi${offline ? ' : envoi automatique au retour du réseau.' : '.'}`
              : 'Dernières données gardées sur l’appareil.'}
          </span>
          {!offline && waiting.length > 0 && (
            <button
              type="button"
              className="rounded-full bg-card px-3 py-1 font-medium text-fg"
              disabled={sending}
              onClick={() => {
                setSending(true);
                void flush().finally(() => setSending(false));
              }}
            >
              {sending ? 'Envoi…' : 'Envoyer maintenant'}
            </button>
          )}
        </div>
      )}
      {refused.map((f) => (
        <div key={f.id} className="flex items-start gap-2 rounded-[18px] bg-pr px-4 py-2.5 text-sm text-ink">
          <span className="flex-1">
            <b className="font-semibold">Pointage non enregistré</b> · {f.label} : {f.message}
          </span>
          <button type="button" aria-label="Masquer" className="font-semibold" onClick={() => dismissFailure(f.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Entraîneur : tant que le réseau est là, prépare le terrain sans réseau (séances d'aujourd'hui et des 2 jours
 * suivants, feuilles de présence, objectifs de séance, écrans Présences et Séances).
 */
export function useCoachOfflinePrefetch() {
  const me = useMe();
  useEffect(() => {
    if (me.space !== 'coach') return;
    let stop = false;
    const run = async () => {
      if (isOffline()) return;
      void import('../pages/coach/CoachAttendancePage');
      void import('../pages/coach/CoachSessionsPage');
      for (let i = 0; i < 3 && !stop; i++) {
        const day = addDays(todayIso(), i);
        const sessions = await api.get<CoachSession[]>('/sessions', { from: day, to: day }).catch(() => [] as CoachSession[]);
        for (const s of sessions) {
          if (stop || s.resolution === 'CANCELLED') continue;
          await api.get('/attendance', { slotId: s.slotId, date: s.date }).catch(() => undefined);
          await api.get('/sessions/review', { slotId: s.slotId, date: s.date }).catch(() => undefined);
        }
      }
    };
    const t = setTimeout(() => void run(), 4_000);
    const every = setInterval(() => void run(), 30 * 60_000);
    return () => {
      stop = true;
      clearTimeout(t);
      clearInterval(every);
    };
  }, [me.space, me.id]);
}
