import { Pressable, View } from 'react-native';
import { addDays, fDYear, todayIso } from '../../lib/format';
import { useTheme } from '../../lib/theme';
import { T } from '../ui';

/** « AAAA-MM-JJ » valide (jour existant). */
export function isIsoDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Choix d'une date sans bibliothèque : « ‹ » / « › » d'un jour, « −7 » / « +7 » d'une semaine.
 * `optional` : une case vide est possible (« Choisir »), et « Effacer » la vide.
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  optional?: boolean;
}) {
  const { t } = useTheme();
  const base = value || min || todayIso();
  const move = (n: number) => {
    const next = addDays(base, value ? n : 0);
    onChange(min && next < min ? min : next);
  };
  const btn = (text: string, n: number, a11y: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => move(n)}
      hitSlop={4}
      style={({ pressed }) => ({ backgroundColor: t.btn, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 8, opacity: pressed ? 0.8 : 1 })}
    >
      <T w="medium" size={14}>
        {text}
      </T>
    </Pressable>
  );
  return (
    <View style={{ gap: 6 }}>
      <T size={12} mut w="medium">
        {label}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.fld, borderRadius: 20, padding: 6 }}>
        {btn('−7', -7, `${label} : une semaine plus tôt`)}
        {btn('‹', -1, `${label} : jour précédent`)}
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} : ${value ? fDYear(value) : 'non choisie'}`} onPress={() => !value && move(0)} style={{ flex: 1, alignItems: 'center' }}>
          <T w="semibold" size={14} color={value ? undefined : t.mut}>
            {value ? fDYear(value) : 'Choisir'}
          </T>
        </Pressable>
        {btn('›', 1, `${label} : jour suivant`)}
        {btn('+7', 7, `${label} : une semaine plus tard`)}
      </View>
      {optional && value ? (
        <Pressable accessibilityRole="button" onPress={() => onChange('')} style={{ alignSelf: 'flex-start' }}>
          <T size={12} color={t.pri} w="medium">
            Effacer
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}
