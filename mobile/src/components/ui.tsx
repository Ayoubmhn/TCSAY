import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage } from '../lib/api';
import { FONT, PILL, useTheme, type PillTone } from '../lib/theme';

/**
 * Composants écrits à la main d'après le design system (docs/tcsay-prototype-v4.html) :
 * clair, aéré, très arrondi, sans ombres, une seule police (Montserrat), une seule couleur d'action (#5a5acd).
 */

type Weight = 'regular' | 'medium' | 'semibold';

export function T({
  children,
  w = 'regular',
  size = 15,
  color,
  mut,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  w?: Weight;
  size?: number;
  color?: string;
  mut?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const { t } = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[{ fontFamily: FONT[w], fontSize: size, color: color ?? (mut ? t.mut : t.fg), lineHeight: Math.round(size * 1.4) }, style]}>
      {children}
    </Text>
  );
}

/** Écran défilant : marges 16px, zone sûre en haut, tirer pour actualiser. */
export function Screen({ children, onRefresh, refreshing = false }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 32, gap: 14 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.pri} colors={[t.pri]} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

/** Titre de page (h1 23px mobile) et sous-titre « Découvrez vos … ». */
export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <T w="semibold" size={23}>
          {title}
        </T>
        {subtitle ? <T mut>{subtitle}</T> : null}
      </View>
      {right}
    </View>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ gap: 10, marginTop: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T w="medium" size={17}>
          {title}
        </T>
        {right}
      </View>
      {children}
    </View>
  );
}

/** Carte : bordure 1,5px, rayon 24px, sans ombre. */
export function Card({ children, style, onPress, faded }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; faded?: boolean }) {
  const { t } = useTheme();
  const body = (
    <View style={[{ backgroundColor: t.card, borderColor: t.line, borderWidth: 1.5, borderRadius: 24, padding: 18, gap: 10, opacity: faded ? 0.7 : 1 }, style]}>
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {body}
    </Pressable>
  );
}

export function CardRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>{children}</View>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <T w="medium" size={16} style={{ flexShrink: 1 }}>
      {children}
    </T>
  );
}

export function CardSubtitle({ children }: { children: ReactNode }) {
  return (
    <T w="semibold" size={13} mut>
      {children}
    </T>
  );
}

export function Kpi({ children }: { children: ReactNode }) {
  return (
    <T w="semibold" size={28}>
      {children}
    </T>
  );
}

/** Pastille : rayon 99px, padding 5px 13px, texte toujours #111. */
export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <View style={{ backgroundColor: PILL[tone], borderRadius: 99, paddingHorizontal: 13, paddingVertical: 5, alignSelf: 'flex-start', maxWidth: '100%' }}>
      <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: '#111' }}>{children}</Text>
    </View>
  );
}

export function Pills({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{children}</View>;
}

type Variant = 'primary' | 'secondary' | 'danger';

/** Bouton pilule : indigo (action principale), gris (secondaire), rose (archiver, désactiver). */
export function Button({
  children,
  onPress,
  variant = 'secondary',
  disabled,
  loading,
  full,
}: {
  children: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
}) {
  const { t } = useTheme();
  const bg = variant === 'primary' ? t.pri : variant === 'danger' ? PILL.r : t.btn;
  const fg = variant === 'primary' ? '#fff' : variant === 'danger' ? '#111' : t.fg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        backgroundColor: bg,
        borderRadius: 99,
        paddingHorizontal: variant === 'primary' ? 22 : 18,
        paddingVertical: variant === 'primary' ? 13 : 11,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        alignSelf: full ? 'stretch' : 'flex-start',
      })}
    >
      {loading && <ActivityIndicator size="small" color={fg} />}
      <Text style={{ fontFamily: variant === 'primary' ? FONT.semibold : FONT.medium, fontSize: variant === 'primary' ? 15 : 14, color: fg }}>{children}</Text>
    </Pressable>
  );
}

/** Bouton icône rond (aria-label obligatoire). */
export function IconButton({ label, onPress, children, tone }: { label: string; onPress: () => void; children: ReactNode; tone?: 'primary' | 'danger' }) {
  const { t } = useTheme();
  const bg = tone === 'primary' ? t.pri : tone === 'danger' ? PILL.r : t.btn;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
    >
      {children}
    </Pressable>
  );
}

/** Champ de formulaire : libellé 12px, fond --fld, rayon 20px. */
export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  const { t } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <T size={12} mut w="medium">
        {label}
      </T>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.mut}
        {...props}
        onFocus={(e) => {
          setFocus(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          props.onBlur?.(e);
        }}
        style={{
          backgroundColor: t.fld,
          borderRadius: 20,
          paddingHorizontal: 18,
          paddingVertical: 13,
          fontFamily: FONT.regular,
          fontSize: 15,
          color: t.fg,
          borderWidth: 2,
          borderColor: focus ? t.pri : 'transparent',
          minHeight: props.multiline ? 90 : undefined,
          textAlignVertical: props.multiline ? 'top' : 'center',
        }}
      />
      {error ? (
        <T size={12} color="#c0392b">
          {error}
        </T>
      ) : null}
    </View>
  );
}

/** Choix en capsule grise (bascule Mois / Semaine, Présent / Retard / Absent…) ; option active #222. */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: t.btn, borderRadius: 99, padding: 3, alignSelf: 'flex-start' }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled }}
            disabled={disabled}
            onPress={() => onChange(o.value)}
            style={{ backgroundColor: on ? '#222' : 'transparent', borderRadius: 99, paddingHorizontal: 13, paddingVertical: 7 }}
          >
            <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: on ? '#fff' : t.fg }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Liste de choix (filtre gris arrondi) : ouvre une feuille avec les options. */
export function Select<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V | undefined;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} : ${current?.label ?? '—'}`}
        onPress={() => setOpen(true)}
        style={{ backgroundColor: t.fld, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}
      >
        <Text style={{ fontFamily: FONT.medium, fontSize: 14, color: t.fg }}>{current?.label ?? label}</Text>
        <Text style={{ color: t.mut, fontSize: 12 }}>▾</Text>
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            onPress={() => {
              onChange(o.value);
              setOpen(false);
            }}
            style={{ paddingVertical: 14, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: t.line, flexDirection: 'row', justifyContent: 'space-between' }}
          >
            <T w={o.value === value ? 'semibold' : 'regular'}>{o.label}</T>
            {o.value === value && <T color={t.pri}>✓</T>}
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

/** Feuille modale (rayon 28px) qui monte du bas, voile sombre. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Fermer" style={{ flex: 1, backgroundColor: t.overlay }} onPress={onClose} />
      <View style={{ backgroundColor: t.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: insets.bottom + 20, maxHeight: '85%', gap: 8 }}>
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: t.line, marginBottom: 6 }} />
        <T w="semibold" size={18}>
          {title}
        </T>
        <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </Modal>
  );
}

/** Confirmation avant une action sensible (archivage, annulation forcée…). */
export function Confirm({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTheme();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.overlay, justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: t.card, borderRadius: 28, padding: 22, gap: 14 }}>
          <T w="semibold" size={18}>
            {title}
          </T>
          <T mut>{message}</T>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
            <Button onPress={onClose}>Annuler</Button>
            <Button
              variant={danger ? 'danger' : 'primary'}
              onPress={() => {
                onConfirm();
                onClose();
              }}
            >
              {confirmLabel}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  const { t } = useTheme();
  return (
    <View style={{ borderWidth: 1.5, borderColor: t.line, borderStyle: 'dashed', borderRadius: 24, padding: 22, alignItems: 'center' }}>
      <T mut style={{ textAlign: 'center' }}>
        {children}
      </T>
    </View>
  );
}

/** Note de règle (rayon 18px, fond --dr). */
export function Note({ children }: { children: ReactNode }) {
  const { t } = useTheme();
  return (
    <View style={{ backgroundColor: t.dr, borderRadius: 18, padding: 14, borderWidth: 1.5, borderColor: t.line }}>
      <T size={13} mut>
        {children}
      </T>
    </View>
  );
}

/** Chargement, erreur avec « Réessayer », puis contenu. */
export function QueryState({ isPending, error, refetch, children }: { isPending: boolean; error: unknown; refetch?: () => void; children: ReactNode }) {
  const { t } = useTheme();
  if (isPending) {
    return (
      <View style={{ padding: 30, alignItems: 'center' }}>
        <ActivityIndicator color={t.pri} />
      </View>
    );
  }
  if (error) {
    return (
      <Card>
        <Pill tone="r">Erreur</Pill>
        <T>{errorMessage(error)}</T>
        {refetch && <Button onPress={refetch}>Réessayer</Button>}
      </Card>
    );
  }
  return <>{children}</>;
}

/** Avatar à initiales (60×68 sur l'accueil, avec point vert). */
export function Avatar({ text, big }: { text: string; big?: boolean }) {
  const { t } = useTheme();
  const w = big ? 60 : 40;
  const h = big ? 68 : 40;
  return (
    <View style={{ width: w, height: h }}>
      <View style={{ width: w, height: h, borderRadius: big ? 22 : 20, backgroundColor: t.btn, alignItems: 'center', justifyContent: 'center' }}>
        <T w="semibold" size={big ? 20 : 14}>
          {text}
        </T>
      </View>
      {big && <View style={{ position: 'absolute', right: -2, bottom: 4, width: 14, height: 14, borderRadius: 7, backgroundColor: '#3cb043', borderWidth: 2, borderColor: t.bg }} />}
    </View>
  );
}

/** Ligne de menu : icône, libellé, chevron. */
export function MenuRow({ label, icon, onPress, right, danger }: { label: string; icon?: ReactNode; onPress: () => void; right?: ReactNode; danger?: boolean }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 6, opacity: pressed ? 0.7 : 1 })}
    >
      {icon}
      <T w="medium" style={{ flex: 1 }} color={danger ? '#c0392b' : undefined}>
        {label}
      </T>
      {right ?? <T mut>›</T>}
    </Pressable>
  );
}

export function Divider() {
  const { t } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: t.line }} />;
}

/** Barre de progression (tranche payée, capacité d'un groupe). */
export function ProgressBar({ value, max }: { value: number; max: number }) {
  const { t } = useTheme();
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <View style={{ height: 8, borderRadius: 99, backgroundColor: t.line, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', borderRadius: 99, backgroundColor: t.pri }} />
    </View>
  );
}
