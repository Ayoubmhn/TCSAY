import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fD } from '../../lib/format';
import { FONT, PILL, useTheme } from '../../lib/theme';
import { Card, CardRow, CardTitle, Pill, Pills, T } from '../ui';
import { first, type MatchSummary } from './types';

/** « ‹ Retour » en haut d'un écran hors onglets (vers `fallback` si l'historique est vide). */
export function BackLink({ label = '‹ Retour', fallback = '/' }: { label?: string; fallback?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Retour"
      hitSlop={10}
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback as never))}
      style={{ alignSelf: 'flex-start' }}
    >
      <T w="medium" size={14} mut>
        {label}
      </T>
    </Pressable>
  );
}

/** Pastille rose « En direct » avec point rouge. */
export function LivePill() {
  return (
    <View style={{ backgroundColor: PILL.r, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 5, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#e5484d' }} />
      <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: '#111' }}>En direct</Text>
    </View>
  );
}

export function StatusPill({ m }: { m: MatchSummary }) {
  if (m.status === 'LIVE') return <LivePill />;
  if (m.status === 'FINISHED') return <Pill tone="g">{`${first((m.winner === 0 ? m.playerA.name : m.playerB.name) ?? '')} gagne`}</Pill>;
  if (m.status === 'ABANDONED') return <Pill tone="s">Abandon</Pill>;
  return <Pill tone="s">À venir</Pill>;
}

/** Carte d'un match dans la liste : joueurs, statut, score (et points en direct), type, date, terrain. */
export function MatchCard({ m }: { m: MatchSummary }) {
  const live = m.live ? `${m.score ? ' · ' : ''}${m.live.point[0] || 'AV'}-${m.live.point[1] || 'AV'}` : '';
  return (
    <Card onPress={() => router.push(`/matchs/${m.id}` as never)}>
      <CardRow>
        <CardTitle>{`${m.playerA.name} contre ${m.playerB.name}`}</CardTitle>
        <StatusPill m={m} />
      </CardRow>
      <Pills>
        {m.score || m.live ? <Pill tone="b">{`${m.score ?? ''}${live}`}</Pill> : null}
        <Pill tone="s">{m.title ?? m.kindLabel}</Pill>
        <Pill tone="b">{fD(m.date)}</Pill>
        {m.court ? <Pill tone="g">{m.court}</Pill> : null}
      </Pills>
    </Card>
  );
}

/** Gros bouton tactile (saisie au bord du terrain) : 72 px de haut, rayon 22. */
export function BigButton({
  children,
  onPress,
  bg,
  color = '#111',
  disabled,
  label,
}: {
  children: ReactNode;
  onPress: () => void;
  bg: string;
  color?: string;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: '45%',
        minHeight: 72,
        borderRadius: 22,
        paddingHorizontal: 12,
        paddingVertical: 14,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ fontFamily: FONT.semibold, fontSize: 16, color, textAlign: 'center' }}>{children}</Text>
    </Pressable>
  );
}

/** Case à cocher faite main (ligne entière tactile). */
export function CheckRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, opacity: disabled ? 0.55 : 1 }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: checked ? t.pri : t.line,
          backgroundColor: checked ? t.pri : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Text style={{ color: '#fff', fontFamily: FONT.semibold, fontSize: 14 }}>✓</Text> : null}
      </View>
      <T style={{ flex: 1 }}>{label}</T>
    </Pressable>
  );
}
