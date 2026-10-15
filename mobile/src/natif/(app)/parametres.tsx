import { router } from 'expo-router';
import { View } from 'react-native';
import { useAuth, useMe } from '../../auth/AuthContext';
import { Button, Card, Note, PageHeader, Screen, Section, Segmented, T } from '../../components/ui';
import { getServer } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { SPACE_LABEL } from '../../lib/nav';
import { useTheme, type ThemeMode } from '../../lib/theme';

function Line({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={{ gap: 2 }}>
      <T size={12} mut w="medium">
        {label}
      </T>
      <T>{value || '—'}</T>
    </View>
  );
}

/** Paramètres : compte en lecture seule, mot de passe, thème, serveur. */
export default function SettingsScreen() {
  const me = useMe();
  const { logout } = useAuth();
  const { mode, setMode } = useTheme();
  return (
    <Screen>
      <PageHeader title="Paramètres" subtitle="Votre compte et les préférences de l’application." />
      <Section title="Mon compte">
        <Card>
          <Line label="Nom" value={`${me.firstName} ${me.lastName}`} />
          <Line label="Email" value={me.email} />
          <Line label="Téléphone" value={me.phone} />
          <Line label="CIN" value={me.cin} />
          <Line label="Espaces" value={me.spaces.map((s) => SPACE_LABEL[s]).join(', ')} />
          <Line label="Dernière connexion" value={me.lastLoginAt ? formatDateTime(me.lastLoginAt) : null} />
          <T mut size={12}>
            Nom, date de naissance et catégorie se modifient au club (administration).
          </T>
        </Card>
      </Section>
      <Section title="Sécurité">
        <Card>
          <Button variant="primary" onPress={() => router.push('/mot-de-passe')}>
            Changer le mot de passe
          </Button>
        </Card>
      </Section>
      <Section title="Préférences">
        <Card>
          <T size={12} mut w="medium">
            Thème
          </T>
          <Segmented<ThemeMode>
            label="Thème"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: '☀ Clair' },
              { value: 'dark', label: '☾ Sombre' },
            ]}
          />
        </Card>
      </Section>
      <Section title="Application">
        <Card>
          <Line label="Serveur" value={getServer()} />
          <Line label="Version" value="0.1.0" />
          <Button variant="danger" onPress={logout}>
            Se déconnecter
          </Button>
        </Card>
      </Section>
      <Note>L’adresse du serveur se change sur l’écran de connexion (après déconnexion).</Note>
    </Screen>
  );
}
