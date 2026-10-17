import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { useTheme } from '../../lib/theme';
import { T } from '../ui';

/** « ‹ Retour » en haut d'un écran hors onglets (vers `fallback` si l'historique est vide). */
export function BackLink({ fallback = '/plus' }: { fallback?: string }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Retour"
      hitSlop={8}
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback as never))}
      style={{ alignSelf: 'flex-start' }}
    >
      <T w="medium" color={t.pri}>
        ‹ Retour
      </T>
    </Pressable>
  );
}
