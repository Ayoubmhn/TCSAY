import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Grid, SlotState } from '../../lib/types';
import { FONT, PILL, useTheme } from '../../lib/theme';

const LABEL: Record<SlotState | 'chosen', string> = {
  free: 'Libre',
  short: '30 min',
  mine: 'Moi',
  taken: 'Pris',
  group: 'Groupe',
  maintenance: 'Entretien',
  unlit: 'Sans éclairage',
  past: '—',
  chosen: 'Choisi',
};

/** Libellé lu par le lecteur d'écran (plus explicite que le texte de la case). */
const SPOKEN: Record<SlotState | 'chosen', string> = {
  free: 'libre',
  short: '30 minutes libres seulement',
  mine: 'déjà réservé par vous',
  taken: 'pris',
  group: 'réservé à un groupe',
  maintenance: 'en entretien',
  unlit: 'sans éclairage',
  past: 'passé',
  chosen: 'choisi',
};

/** Sélection : demi-heures consécutives d'un même terrain, en minutes depuis minuit ([start, end[). */
export type Pick = { courtId: string; start: number; end: number };

/** « 17:30 » → minutes depuis minuit. */
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** 1050 → « 17:30 ». */
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** 90 → « 1 h 30 ». */
export const durationText = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}`;

const TIME_COL = 58;
const MIN_COL = 84;
const GAP = 6;

/**
 * Grille de réservation heures × terrains, une ligne par demi-heure, créneau libre en vert « Libre ».
 * Premier toucher : 1 h à partir de la demi-heure choisie ; toucher une autre demi-heure du même terrain : la
 * réservation s'étend jusqu'à elle (demi-heures consécutives et libres, 4 h au plus) ; toucher dans la sélection : on l'efface.
 * Défile horizontalement quand les terrains ne tiennent pas dans la largeur.
 */
export function BookingGrid({
  grid,
  pick,
  onPick,
  onBlocked,
  onNotice,
}: {
  grid: Grid;
  pick: Pick | null;
  onPick: (pick: Pick | null) => void;
  onBlocked: (state: SlotState) => void;
  /** Message d'aide (prolongation impossible…). */
  onNotice: (message: string) => void;
}) {
  const { t } = useTheme();
  const [width, setWidth] = useState(0);
  const cols = grid.courts.length;
  const step = 30;
  const colWidth = cols ? Math.max(MIN_COL, Math.floor((width - TIME_COL - GAP * cols) / cols)) : MIN_COL;

  const blockFree = (c: number, m: number) => {
    const i = grid.times.indexOf(hhmm(m));
    return i >= 0 && ['free', 'short'].includes(grid.slots[c].times[i].state);
  };
  const rangeFree = (c: number, from: number, to: number) => {
    for (let m = from; m < to; m += step) if (!blockFree(c, m)) return false;
    return true;
  };

  const choose = (c: number, courtId: string, time: string, base: SlotState) => {
    const tm = toMinutes(time);
    if (pick && pick.courtId === courtId) {
      if (tm >= pick.start && tm < pick.end) return onPick(null);
      const start = Math.min(pick.start, tm);
      const end = Math.max(pick.end, tm + step);
      if (end - start > grid.maxDurationMinutes) return onNotice(`Réservation de ${durationText(grid.maxDurationMinutes)} au plus.`);
      if (!rangeFree(c, start, end)) return onNotice('Pour prolonger, toutes les demi-heures entre les deux doivent être libres.');
      return onPick({ courtId, start, end });
    }
    if (base !== 'free') return onBlocked(base);
    onPick({ courtId, start: tm, end: tm + grid.durationMinutes });
  };

  const bgOf = (state: SlotState | 'chosen') =>
    state === 'chosen'
      ? t.sel
      : state === 'free'
        ? PILL.g
        : state === 'mine'
          ? PILL.b
          : state === 'taken' || state === 'group'
            ? PILL.r
            : state === 'past'
              ? t.fld
              : PILL.s;

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width - 28 - 3)}
      style={{ backgroundColor: t.card, borderColor: t.line, borderWidth: 1.5, borderRadius: 24, padding: 14 }}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={TIME_COL + cols * (colWidth + GAP) > width}>
        <View accessibilityLabel="Créneaux disponibles" style={{ gap: GAP }}>
          <View style={{ flexDirection: 'row', gap: GAP }}>
            <View style={{ width: TIME_COL }} />
            {grid.courts.map((court) => (
              <View key={court.id} style={{ width: colWidth, paddingVertical: 4 }}>
                <Text numberOfLines={2} style={{ fontFamily: FONT.semibold, fontSize: 13, color: t.fg, textAlign: 'center' }}>
                  {court.name}
                  {court.lit ? ' ☀' : ''}
                </Text>
              </View>
            ))}
          </View>
          {grid.times.map((time, r) => {
            const night = toMinutes(time) >= grid.nightStartHour * 60;
            return (
              <View key={time} style={{ flexDirection: 'row', gap: GAP, alignItems: 'center' }}>
                <Text style={{ width: TIME_COL, fontFamily: FONT.medium, fontSize: 13, color: time.endsWith(':00') ? t.fg : t.mut, fontVariant: ['tabular-nums'] }}>
                  {time}
                  {night ? ' ☾' : ''}
                </Text>
                {grid.courts.map((court, c) => {
                  const base = grid.slots[c].times[r].state;
                  const tm = toMinutes(time);
                  const chosen = pick?.courtId === court.id && tm >= pick.start && tm < pick.end;
                  const state = chosen ? 'chosen' : base;
                  const blocked = base !== 'free' && !(pick?.courtId === court.id && base === 'short');
                  return (
                    <Pressable
                      key={court.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${court.name}${court.lit ? ', éclairé' : ''}, ${time}${night ? ', nuit' : ''}, ${SPOKEN[state]}`}
                      accessibilityState={{ selected: chosen, disabled: blocked && !chosen }}
                      onPress={() => choose(c, court.id, time, base)}
                      style={({ pressed }) => ({
                        width: colWidth,
                        height: 36,
                        borderRadius: 12,
                        backgroundColor: bgOf(state),
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: state === 'past' ? 0.35 : pressed ? 0.8 : 1,
                      })}
                    >
                      <Text numberOfLines={1} style={{ fontFamily: FONT.medium, fontSize: 12, color: state === 'chosen' ? '#fff' : state === 'past' ? t.fg : '#111' }}>
                        {state === 'past' ? '' : LABEL[state]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
