import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

/**
 * Application TCSAY : le site web complet (tous les modules, toujours à jour) dans une vue plein écran.
 * Adresse : EXPO_PUBLIC_WEB_URL (eas.json), sinon le site en ligne.
 */
const SITE = (process.env.EXPO_PUBLIC_WEB_URL ?? 'https://tcsay.vercel.app').replace(/\/+$/, '');
const SITE_ORIGIN = SITE.match(/^https?:\/\/[^/]+/)?.[0] ?? SITE;

/** Couleur de fond de la page, envoyée à l'application pour colorer les bandes système (thème clair / sombre). */
const WATCH_THEME = `
(function () {
  var last = '';
  function send() {
    var bg = getComputedStyle(document.body || document.documentElement).backgroundColor;
    if (bg && bg !== last) { last = bg; window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'bg', value: bg })); }
  }
  new MutationObserver(send).observe(document.documentElement, { attributes: true, subtree: false });
  document.addEventListener('DOMContentLoaded', send);
  setInterval(send, 1500);
  send();
})();
true;
`;

/** « rgb(18, 18, 18) » → sombre ? */
function isDark(color: string) {
  const m = color.match(/\d+/g);
  if (!m) return false;
  const [r, g, b] = m.map(Number);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

export default function SiteScreen() {
  const system = useColorScheme();
  const web = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bg, setBg] = useState(system === 'dark' ? '#121212' : '#fafafa');
  const dark = isDark(bg);

  // Bouton retour d'Android : page précédente du site, sinon fermeture normale.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && web.current) {
        web.current.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  const onNav = useCallback((nav: WebViewNavigation) => setCanGoBack(nav.canGoBack), []);

  // Liens hors du site (téléphone, email, WhatsApp, vidéos…) : application correspondante.
  const onShouldStart = useCallback((req: { url: string }) => {
    const url = req.url;
    if (url.startsWith(SITE_ORIGIN) || url.startsWith('about:') || url.startsWith('blob:') || url.startsWith('data:')) return true;
    void Linking.openURL(url).catch(() => undefined);
    return false;
  }, []);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as { type: string; value: string };
      if (msg.type === 'bg' && msg.value) setBg(msg.value);
    } catch {
      /* message ignoré */
    }
  }, []);

  const retry = () => {
    setOffline(false);
    setLoading(true);
    web.current?.reload();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {offline ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
          <Text style={{ fontSize: 23, fontWeight: '600', color: dark ? '#f2f2f2' : '#1a1a1a' }}>Pas de connexion</Text>
          <Text style={{ fontSize: 15, color: dark ? '#9a9aa0' : '#8a8a8f', textAlign: 'center' }}>
            Vérifiez le réseau (Wi-Fi ou données mobiles) : votre session est gardée.
          </Text>
          <Pressable accessibilityRole="button" onPress={retry} style={{ backgroundColor: '#5a5acd', borderRadius: 99, paddingHorizontal: 24, paddingVertical: 13 }}>
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Réessayer</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          ref={web}
          source={{ uri: SITE }}
          style={{ flex: 1, backgroundColor: bg }}
          applicationNameForUserAgent="TCSAYApp/0.2"
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          allowFileAccess
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          mediaPlaybackRequiresUserAction
          injectedJavaScript={WATCH_THEME}
          onMessage={onMessage}
          onNavigationStateChange={onNav}
          onShouldStartLoadWithRequest={onShouldStart}
          onLoadEnd={() => {
            setLoading(false);
            void SplashScreen.hideAsync();
          }}
          onError={() => {
            setOffline(true);
            void SplashScreen.hideAsync();
          }}
          overScrollMode="never"
          textZoom={100}
          {...(Platform.OS === 'android' ? { mixedContentMode: 'compatibility' as const } : {})}
        />
      )}
      {loading && !offline && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }}>
          <ActivityIndicator color="#5a5acd" size="large" />
        </View>
      )}
    </SafeAreaView>
  );
}
