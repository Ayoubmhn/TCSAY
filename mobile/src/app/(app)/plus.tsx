import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useAuth, useMe } from '../../auth/AuthContext';
import { IconBell, IconCalendar, IconCard, IconChart, IconClipboard, IconHome, IconLogout, IconSettings, IconSwap, IconUserOff, IconWallet } from '../../components/Icons';
import { Avatar, Card, Divider, MenuRow, Note, PageHeader, Pill, Pills, Screen, Section, T } from '../../components/ui';
import { getServer, type Space } from '../../lib/api';
import { initials } from '../../lib/format';
import { homeOf, SPACE_LABEL } from '../../lib/nav';
import { useTheme } from '../../lib/theme';

type Item = { label: string; path: string; icon: (c: string) => ReactNode };

const FAMILY: Item[] = [
  { label: 'Accueil', path: '/', icon: (c) => <IconHome color={c} /> },
  { label: 'Mes séances', path: '/seances', icon: (c) => <IconCalendar color={c} /> },
  { label: 'Mes absences', path: '/absences', icon: (c) => <IconUserOff color={c} /> },
  { label: 'Mes paiements', path: '/paiements', icon: (c) => <IconCard color={c} /> },
];
const COACH: Item[] = [
  { label: 'Mes séances', path: '/coach/seances', icon: (c) => <IconCalendar color={c} /> },
  { label: 'Présences', path: '/coach/presences', icon: (c) => <IconClipboard color={c} /> },
  { label: 'Mes salaires', path: '/coach/salaires', icon: (c) => <IconWallet color={c} /> },
];
const ADMIN: Item[] = [{ label: 'Dashboard', path: '/admin', icon: (c) => <IconChart color={c} /> }];

/** Menu : modules de l'espace, changement d'espace, paramètres, déconnexion. */
export default function MenuScreen() {
  const me = useMe();
  const { t } = useTheme();
  const { logout, switchSpace } = useAuth();
  const items = me.space === 'coach' ? COACH : me.space === 'admin' ? ADMIN : FAMILY;
  const go = (path: string) => router.push(path as never);

  return (
    <Screen>
      <PageHeader title="Menu" subtitle="Tous les modules de votre espace." />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar text={initials(me.firstName, me.lastName)} />
          <View style={{ flex: 1 }}>
            <T w="semibold">{`${me.firstName} ${me.lastName.toUpperCase()}`}</T>
            <T mut size={13} numberOfLines={1}>
              {me.email ?? me.cin ?? ''}
            </T>
          </View>
          <Pill tone="s">{SPACE_LABEL[me.space]}</Pill>
        </View>
      </Card>

      <Section title={SPACE_LABEL[me.space]}>
        <Card style={{ paddingVertical: 4 }}>
          {items.map((it, i) => (
            <View key={it.path}>
              {i > 0 && <Divider />}
              <MenuRow label={it.label} icon={it.icon(t.fg)} onPress={() => go(it.path)} />
            </View>
          ))}
          <Divider />
          <MenuRow label="Notifications" icon={<IconBell color={t.fg} />} onPress={() => go('/notifications')} />
        </Card>
      </Section>

      {me.spaces.length > 1 && (
        <Section title="Changer d’espace">
          <Card style={{ paddingVertical: 4 }}>
            {me.spaces.map((s: Space, i: number) => (
              <View key={s}>
                {i > 0 && <Divider />}
                <MenuRow
                  label={SPACE_LABEL[s]}
                  icon={<IconSwap color={t.fg} />}
                  right={s === me.space ? <Pill tone="g">Actuel</Pill> : undefined}
                  onPress={() => {
                    if (s === me.space) return;
                    switchSpace(s);
                    router.replace(homeOf({ space: s }) as never);
                  }}
                />
              </View>
            ))}
          </Card>
        </Section>
      )}

      <Section title="Compte">
        <Card style={{ paddingVertical: 4 }}>
          <MenuRow label="Paramètres" icon={<IconSettings color={t.fg} />} onPress={() => go('/parametres')} />
          <Divider />
          <MenuRow label="Se déconnecter" danger icon={<IconLogout color="#c0392b" />} onPress={logout} />
        </Card>
      </Section>

      {me.space === 'admin' && (
        <Note>
          Les écrans de gestion (joueurs, groupes, paiements, tarifs…) arrivent dans l’application au fil des lots. En attendant, ils restent sur le site :
          {` ${getServer()}`}.
        </Note>
      )}
      <Pills>
        <Pill tone="s">TCSAY mobile 0.1</Pill>
      </Pills>
      <T mut size={12} style={{ textAlign: 'center' }}>
        Tennis Club de Sayada
      </T>
    </Screen>
  );
}
