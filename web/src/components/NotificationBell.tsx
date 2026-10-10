import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { IconBell } from './ui/Icons';

/** Cloche de l'en-tête : nombre de notifications non lues, relu toutes les 60 s. */
export function NotificationBell() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => api.get<{ unread: number }>('/notifications/count'),
    refetchInterval: 60_000,
  });
  const unread = q.data?.unread ?? 0;
  const label = unread ? `${t('Notifications')} (${unread} ${t('non lue(s)')})` : t('Notifications');
  return (
    <Link to="/notifications" aria-label={label} title={label} className="relative grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[15px] bg-btn text-fg">
      <IconBell />
      {unread > 0 && (
        <span className="absolute -end-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-pr px-1 text-[11px] font-semibold text-ink tabular-nums" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
