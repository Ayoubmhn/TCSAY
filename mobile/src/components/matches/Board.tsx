import { Text, View } from 'react-native';
import { fD } from '../../lib/format';
import { FONT, PILL, useTheme } from '../../lib/theme';
import { Pill, Pills } from '../ui';
import { LivePill } from './common';
import { first, type MatchDetail, type Side } from './types';

/** Tableau de score : serveur, sets (avec tie-break en exposant), points du jeu en cours ; pastilles d'état dessous. */
export function Board({ m }: { m: MatchDetail }) {
  const { t } = useTheme();
  const s = m.state;
  const sets = s?.sets ?? [];
  const live = m.status === 'LIVE';
  const num = { fontVariant: ['tabular-nums' as const] };

  const row = (i: Side) => {
    const name = i === 0 ? m.playerA.name : m.playerB.name;
    return (
      <View
        key={i}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: i === 1 ? 1.5 : 0, borderTopColor: t.line }}
      >
        <View style={{ width: 14, alignItems: 'center' }}>
          {live && s?.server === i ? (
            <View accessibilityLabel="Au service" style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: '#111', backgroundColor: PILL.g }} />
          ) : null}
        </View>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.semibold, fontSize: 15, color: t.fg }}>
          {name}
          {m.winner === i ? <Text style={{ color: t.pri }}> ✓</Text> : null}
        </Text>
        {sets.length ? (
          sets.map((set, k) => {
            const current = k === sets.length - 1 && live;
            return (
              <Text key={k} style={[{ width: 26, textAlign: 'center', fontFamily: current ? FONT.semibold : FONT.regular, fontSize: 16, color: current ? t.fg : t.mut }, num]}>
                {set.games[i]}
                {set.tiebreak ? <Text style={{ fontSize: 10 }}>{set.tiebreak[i]}</Text> : null}
              </Text>
            );
          })
        ) : (
          <Text style={{ width: 26, textAlign: 'center', color: t.mut, fontFamily: FONT.regular }}>–</Text>
        )}
        <View style={{ width: 54, borderRadius: 14, backgroundColor: t.fld, paddingVertical: 6, alignItems: 'center' }}>
          <Text style={[{ fontFamily: FONT.semibold, fontSize: 19, color: t.fg }, num]}>{live ? s?.point[i] || ' ' : m.winner === i ? '✓' : ' '}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={{ borderWidth: 1.5, borderColor: t.line, borderRadius: 24, backgroundColor: t.card, overflow: 'hidden' }}>
        {row(0)}
        {row(1)}
      </View>
      <Pills>
        {live ? (
          <LivePill />
        ) : m.status === 'FINISHED' ? (
          <Pill tone="g">{`Terminé ${m.score ?? ''}`}</Pill>
        ) : m.status === 'ABANDONED' ? (
          <Pill tone="s">Abandon</Pill>
        ) : (
          <Pill tone="s">À venir</Pill>
        )}
        {live && s?.tiebreak ? <Pill tone="s">{s.tiebreak === 'SUPER' ? 'Super tie-break (10 points)' : 'Tie-break'}</Pill> : null}
        {live && s?.breakPoint ? <Pill tone="r">{`Balle de break pour ${first(s.server === 0 ? m.playerB.name : m.playerA.name)}`}</Pill> : null}
        {live && s?.decisivePoint ? <Pill tone="s">Point décisif</Pill> : null}
        <Pill tone="s">{m.title ?? m.kindLabel}</Pill>
        <Pill tone="b">{fD(m.date)}</Pill>
        {m.court ? <Pill tone="g">{m.court}</Pill> : null}
      </Pills>
    </View>
  );
}
