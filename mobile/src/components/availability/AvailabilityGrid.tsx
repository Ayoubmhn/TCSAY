import { Pressable, Text, View } from 'react-native';
import { DAY_NAMES } from '../../lib/format';
import { FONT, PILL, useTheme } from '../../lib/theme';
import { Pill, Pills, T } from '../ui';

export type AvailState = 'D' | 'P' | 'I';
export type AvailGrid = Record<string, AvailState>;

const LABEL: Record<AvailState, string> = { D: 'Disponible', P: 'Préféré', I: 'Indisponible' };
const BG: Record<AvailState, string> = { D: PILL.g, P: PILL.b, I: PILL.r };
const NEXT: Record<AvailState | 'none', AvailState | undefined> = { none: 'D', D: 'P', P: 'I', I: undefined };

/** Fait tourner une case : non renseigné → Disponible → Préféré → Indisponible → non renseigné. */
export function cycleCell(grid: AvailGrid, key: string): AvailGrid {
  const next = NEXT[grid[key] ?? 'none'];
  const copy = { ...grid };
  if (next) copy[key] = next;
  else delete copy[key];
  return copy;
}

/**
 * Semaine type (jours en colonnes, heures en lignes), tactile : toucher une case fait tourner D → P → I.
 * Tenue dans la largeur du téléphone (lettres D / P / I, légende en dessous).
 */
export function AvailabilityGrid({ hours, days, grid, onChange }: { hours: number[]; days: number[]; grid: AvailGrid; onChange?: (grid: AvailGrid) => void }) {
  const { t } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <View style={{ width: 36 }} />
        {days.map((d) => (
          <View key={d} style={{ flex: 1, alignItems: 'center' }}>
            <T size={11} w="semibold" mut>
              {DAY_NAMES[d]}
            </T>
          </View>
        ))}
      </View>
      {hours.map((h) => (
        <View key={h} style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          <View style={{ width: 36 }}>
            <T size={11} w="semibold" mut>
              {`${h}h`}
            </T>
          </View>
          {days.map((d) => {
            const key = `${d}-${h}`;
            const state = grid[key];
            return (
              <Pressable
                key={d}
                disabled={!onChange}
                accessibilityRole="button"
                accessibilityLabel={`${DAY_NAMES[d]} ${h}h : ${state ? LABEL[state] : 'non renseigné'}`}
                onPress={() => onChange?.(cycleCell(grid, key))}
                style={({ pressed }) => ({
                  flex: 1,
                  height: 34,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: state ? BG[state] : t.fld,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <Text style={{ fontFamily: FONT.medium, fontSize: 12, color: state ? '#111' : t.mut }}>{state ?? '·'}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={{ marginTop: 6 }}>
        <Pills>
          <Pill tone="g">D · Disponible</Pill>
          <Pill tone="b">P · Préféré</Pill>
          <Pill tone="r">I · Indisponible</Pill>
          <Pill tone="s">· non renseigné</Pill>
        </Pills>
      </View>
    </View>
  );
}
