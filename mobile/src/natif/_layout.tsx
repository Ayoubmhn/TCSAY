import { Montserrat_400Regular, Montserrat_500Medium, Montserrat_600SemiBold, useFonts } from '@expo-google-fonts/montserrat';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/Toast';
import { getItem, setItem } from '../lib/storage';
import { DARK, LIGHT, ThemeContext, type ThemeMode } from '../lib/theme';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Montserrat_400Regular, Montserrat_500Medium, Montserrat_600SemiBold });
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  useEffect(() => {
    void getItem('tcsay.theme').then((m) => m && setModeState(m as ThemeMode));
  }, []);
  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  const theme = useMemo(() => {
    const dark = mode === 'dark' || (mode === 'system' && system === 'dark');
    return {
      t: dark ? DARK : LIGHT,
      dark,
      mode,
      setMode: (m: ThemeMode) => {
        setModeState(m);
        void setItem('tcsay.theme', m);
      },
    };
  }, [mode, system]);

  if (!fontsLoaded) return null;
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={theme}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <AuthProvider>
              <StatusBar style={theme.dark ? 'light' : 'dark'} />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.t.bg } }} />
            </AuthProvider>
          </ToastProvider>
        </QueryClientProvider>
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}
