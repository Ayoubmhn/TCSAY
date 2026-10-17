import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useMe } from '../../auth/AuthContext';
import { FONT, PILL, useTheme } from '../../lib/theme';
import { Button, EmptyState, Field, PageHeader, Screen, T } from '../ui';

/** Le compte connecté a-t-il l'un de ces droits (espace administration) ? */
export function useCan(...perms: string[]): boolean {
  const me = useMe();
  return me.space === 'admin' && perms.some((p) => me.permissions.includes(p));
}

/** « ‹ Retour » en haut des écrans qui ne sont pas des onglets. */
export function BackLink({ label = '‹ Retour', to }: { label?: string; to?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Retour"
      hitSlop={8}
      onPress={() => (router.canGoBack() ? router.back() : to ? router.replace(to as never) : undefined)}
      style={{ alignSelf: 'flex-start' }}
    >
      <T w="medium" size={14} mut>
        {label}
      </T>
    </Pressable>
  );
}

/** Écran affiché sans le droit nécessaire. */
export function NoAccess({ title, perm }: { title: string; perm: string }) {
  return (
    <Screen>
      <BackLink />
      <PageHeader title={title} />
      <EmptyState>Vous n’avez pas l’autorisation nécessaire ({perm}). Demandez-la au président (Paramètres › Autorisations).</EmptyState>
    </Screen>
  );
}

/** Puce à cocher (choix multiple) : #0000e0 cochée, rose pour une exclusion. */
export function Chip({ on, onPress, children, danger, color }: { on: boolean; onPress: () => void; children: string; danger?: boolean; color?: string }) {
  const { t } = useTheme();
  const bg = on ? (danger ? PILL.r : t.sel) : t.fld;
  const fg = on ? (danger ? '#111' : '#fff') : t.fg;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={children}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: bg, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.8 : 1 })}
    >
      {color ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} /> : null}
      <Text style={{ fontFamily: FONT.medium, fontSize: 14, color: fg }}>{children}</Text>
    </Pressable>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}

/** Case à cocher avec libellé. */
export function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 7,
          borderWidth: 2,
          borderColor: checked ? t.pri : t.line,
          backgroundColor: checked ? t.pri : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Text style={{ color: '#fff', fontSize: 13, fontFamily: FONT.semibold }}>✓</Text> : null}
      </View>
      <T size={14} style={{ flex: 1 }}>
        {label}
      </T>
    </Pressable>
  );
}

/** Confirmation avec motif obligatoire (annulation forcée, dérogation R4…). */
export function MotifConfirm({
  open,
  title,
  message,
  confirmLabel,
  danger,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: (motif: string) => void;
  onClose: () => void;
}) {
  const { t } = useTheme();
  const [motif, setMotif] = useState('');
  useEffect(() => {
    if (open) setMotif('');
  }, [open]);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.overlay, justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: t.card, borderRadius: 28, padding: 22, gap: 14 }}>
          <T w="semibold" size={18}>
            {title}
          </T>
          <T mut>{message}</T>
          <Field label="Motif *" value={motif} onChangeText={setMotif} multiline />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <Button onPress={onClose}>Annuler</Button>
            <Button variant={danger ? 'danger' : 'primary'} disabled={!motif.trim()} loading={pending} onPress={() => onConfirm(motif.trim())}>
              {confirmLabel}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Pastille de couleur d'un entraîneur (couleur choisie dans sa fiche). */
export function CoachDot({ name, color }: { name: string; color: string }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.fld, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 5 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: t.fg }}>{name}</Text>
    </View>
  );
}

/** Recherche sans accents ni majuscules. */
export const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
