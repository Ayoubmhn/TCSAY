import { useQuery } from '@tanstack/react-query';
import { Redirect, Tabs } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { IconBell, IconCalendar, IconCard, IconChart, IconClipboard, IconGrid, IconHome, IconWallet } from '../../components/Icons';
import { Button, T } from '../../components/ui';
import { api } from '../../lib/api';
import { FONT, useTheme } from '../../lib/theme';
import type { Space } from '../../lib/types';

type Tab = { name: string; title: string; icon: (color: string) => ReactNode };

const ic =
  (Icon: (p: { color: string; size?: number }) => ReactNode) =>
  (color: string) => <Icon color={color} size={23} />;

/** Onglets du bas par espace (comme la barre mobile du site) ; le reste est dans « Menu ». */
const TABS: Record<Space, string[]> = {
  parent: ['index', 'seances', 'paiements', 'notifications', 'plus'],
  player: ['index', 'seances', 'paiements', 'notifications', 'plus'],
  coach: ['coach/seances', 'coach/presences', 'coach/salaires', 'notifications', 'plus'],
  admin: ['admin', 'notifications', 'plus'],
};

const ALL: Tab[] = [
  { name: 'index', title: 'Accueil', icon: ic(IconHome) },
  { name: 'seances', title: 'Séances', icon: ic(IconCalendar) },
  { name: 'paiements', title: 'Paiements', icon: ic(IconCard) },
  { name: 'coach/seances', title: 'Séances', icon: ic(IconCalendar) },
  { name: 'coach/presences', title: 'Présences', icon: ic(IconClipboard) },
  { name: 'coach/salaires', title: 'Salaires', icon: ic(IconWallet) },
  { name: 'admin', title: 'Accueil', icon: ic(IconChart) },
  { name: 'notifications', title: 'Alertes', icon: ic(IconBell) },
  { name: 'plus', title: 'Menu', icon: ic(IconGrid) },
];

/** Écrans hors onglets (ouverts depuis le menu ou une notification), barre du bas gardée. */
const HIDDEN = ['absences', 'parametres'];

function Centered({ children }: { children: ReactNode }) {
  const { t } = useTheme();
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14, backgroundColor: t.bg }}>{children}</View>;
}

export default function AppLayout() {
  const { me, loading, offline, retry } = useAuth();
  const { t } = useTheme();
  const unread = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => api.get<{ unread: number }>('/notifications/count'),
    enabled: Boolean(me && !me.mustChangePassword),
    refetchInterval: 60_000,
  });

  if (offline) {
    return (
      <Centered>
        <T w="semibold" size={23}>
          Pas de connexion
        </T>
        <T mut style={{ textAlign: 'center' }}>
          Vérifiez le réseau (Wi-Fi ou données mobiles) : votre session est gardée.
        </T>
        <Button variant="primary" onPress={retry}>
          Réessayer
        </Button>
      </Centered>
    );
  }
  if (loading) {
    return (
      <Centered>
        <ActivityIndicator color={t.pri} />
      </Centered>
    );
  }
  if (!me) return <Redirect href="/connexion" />;
  if (me.mustChangePassword) return <Redirect href="/mot-de-passe" />;

  const shown = new Set(TABS[me.space]);
  const badge = unread.data?.unread ? (unread.data.unread > 99 ? '99+' : unread.data.unread) : undefined;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.pri,
        tabBarInactiveTintColor: t.mut,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.line, borderTopWidth: 1.5 },
        tabBarLabelStyle: { fontFamily: FONT.medium, fontSize: 11 },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      {ALL.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            href: shown.has(tab.name) ? undefined : null,
            tabBarIcon: ({ color }) => tab.icon(String(color)),
            tabBarBadge: tab.name === 'notifications' ? badge : undefined,
            tabBarBadgeStyle: { backgroundColor: '#fdb3b0', color: '#111', fontFamily: FONT.semibold, fontSize: 11 },
          }}
        />
      ))}
      {HIDDEN.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
