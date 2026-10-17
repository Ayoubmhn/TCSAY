import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, useTheme } from '../lib/theme';

type ToastFn = (message: string) => void;
const ToastContext = createContext<ToastFn>(() => undefined);
export const useToast = () => useContext(ToastContext);

/** Toast : pilule couleur --fg en bas de l'écran, 3,5 s (erreurs métier R1–R14 comprises). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ToastFn>(
    (m) => {
      setMessage(m);
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setMessage(null));
      }, 3500);
    },
    [opacity],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      {message !== null && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: insets.bottom + 84 }]}>
          <Animated.View accessibilityLiveRegion="polite" style={{ opacity, backgroundColor: t.fg, borderRadius: 99, paddingHorizontal: 20, paddingVertical: 12, maxWidth: '90%' }}>
            <Text style={{ color: t.bg, fontFamily: FONT.medium, fontSize: 14, textAlign: 'center' }}>{message}</Text>
          </Animated.View>
        </View>
      )}
    </ToastContext.Provider>
  );
}
