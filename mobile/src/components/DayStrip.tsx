import { Pressable, ScrollView, Text, View } from 'react-native';
import { DAY_NAMES, addDays, todayIso, weekdayOf } from '../lib/format';
import { FONT, useTheme } from '../lib/theme';

/** Puces de 14 jours (jour choisi #0000e0) ; point sous les jours avec séance. */
export function DayStrip({ value, onChange, dots, days = 14, from }: { value: string; onChange: (d: string) => void; dots?: Set<string>; days?: number; from?: string }) {
  const { t } = useTheme();
  const start = from ?? todayIso();
  const list = Array.from({ length: days }, (_, i) => addDays(start, i));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
      {list.map((d) => {
        const on = d === value;
        return (
          <Pressable
            key={d}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={d}
            onPress={() => onChange(d)}
            style={{ width: 54, paddingVertical: 10, borderRadius: 20, alignItems: 'center', gap: 2, backgroundColor: on ? t.sel : t.day }}
          >
            <Text style={{ fontFamily: FONT.medium, fontSize: 12, color: on ? '#fff' : t.mut }}>{DAY_NAMES[weekdayOf(d)]}</Text>
            <Text style={{ fontFamily: FONT.semibold, fontSize: 17, color: on ? '#fff' : t.fg }}>{Number(d.slice(8, 10))}</Text>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: dots?.has(d) ? (on ? '#fff' : t.pri) : 'transparent' }} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
