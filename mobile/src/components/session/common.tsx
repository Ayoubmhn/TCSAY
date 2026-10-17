import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { T } from '../ui';
import { FONT, useTheme } from '../../lib/theme';

/** « 3.25 » → « 3,3 » (une décimale au plus, virgule française). */
export const nb = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** Bouton « ‹ Retour » en haut des écrans qui ne sont pas des onglets. */
export function BackLink() {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Retour"
      hitSlop={8}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      style={{ alignSelf: 'flex-start', paddingVertical: 4 }}
    >
      <T w="medium" color={t.pri}>
        ‹ Retour
      </T>
    </Pressable>
  );
}

/** Puce de choix (choix rapide) : choisie = #0000e0 texte blanc, sinon --fld. */
export function Chip({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: on ? t.sel : t.fld, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8, opacity: pressed ? 0.85 : 1 })}
    >
      <Text style={{ fontFamily: FONT.medium, fontSize: 14, color: on ? '#fff' : t.fg }}>{label}</Text>
    </Pressable>
  );
}

export function Chips({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <View accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {children}
    </View>
  );
}

/** Notes de 1 à 5 (boutons ronds, note choisie en indigo). */
export function Dots({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const { t } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value === n;
        return (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled }}
            accessibilityLabel={`${label} : ${n} sur 5`}
            disabled={disabled}
            hitSlop={2}
            onPress={() => onChange(n)}
            style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.pri : t.fld }}
          >
            <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: on ? '#fff' : t.fg }}>{n}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Case à cocher (partage d'un bilan…). */
export function CheckRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: value ? t.pri : t.line,
          backgroundColor: value ? t.pri : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {value && <Text style={{ color: '#fff', fontFamily: FONT.semibold, fontSize: 14 }}>✓</Text>}
      </View>
      <T style={{ flex: 1 }}>{label}</T>
    </Pressable>
  );
}

/** Libellé de champ 12px (au-dessus d'un groupe de puces). */
export function Label({ children }: { children: string }) {
  return (
    <T size={12} mut w="medium">
      {children}
    </T>
  );
}
