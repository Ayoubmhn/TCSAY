import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Button, Card, Field, Note, Screen, Sheet, T } from '../components/ui';
import { DEFAULT_SERVER, api, errorMessage, getServer, normalizeServer, setServer } from '../lib/api';
import { homeOf } from '../lib/nav';
import { FONT, useTheme } from '../lib/theme';

/** Connexion (vLogin) : identifiant (email ou CIN), mot de passe, rester connecté ; adresse du serveur réglable. */
export default function LoginScreen() {
  const { me, login } = useAuth();
  const { t } = useTheme();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const [server, setServerField] = useState(getServer());
  const [forgotOpen, setForgotOpen] = useState(false);

  if (me) return <Redirect href={me.mustChangePassword ? '/mot-de-passe' : homeOf(me)} />;

  const submit = async () => {
    if (!email.trim() || !password) return toast('Saisissez votre identifiant et votre mot de passe.');
    setPending(true);
    try {
      // La redirection se fait au rendu suivant (profil chargé), voir plus haut.
      await login(email.trim(), password, remember);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 30 }}>
          <Image source={require('../../assets/logo.png')} style={{ width: 58, height: 58 }} accessibilityIgnoresInvertColors accessibilityLabel="Logo du Tennis Club de Sayada" />
          <View>
            <T w="semibold" size={20}>
              TCSAY
            </T>
            <T mut>Tennis Club de Sayada</T>
          </View>
        </View>
        <View style={{ gap: 4, marginTop: 10 }}>
          <T w="semibold" size={25}>
            Connexion
          </T>
          <T mut>Les comptes sont créés par l’administrateur du club.</T>
        </View>
        <Card>
          <Field
            label="Identifiant (email ou CIN)"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="username"
            placeholder="prenom.nom@exemple.tn ou 09123456"
          />
          <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: remember }}
            onPress={() => setRemember((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 7,
                borderWidth: 2,
                borderColor: t.pri,
                backgroundColor: remember ? t.pri : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {remember && <T color="#fff" size={13} w="semibold">✓</T>}
            </View>
            <T style={{ flex: 1 }}>
              Rester connecté <T mut>(30 jours, appareil personnel)</T>
            </T>
          </Pressable>
          <Button variant="primary" full onPress={submit} loading={pending}>
            Se connecter
          </Button>
          <Pressable accessibilityRole="button" onPress={() => setForgotOpen(true)} style={{ alignSelf: 'center', padding: 6 }}>
            <T color={t.pri} w="medium" size={14}>
              Mot de passe oublié ?
            </T>
          </Pressable>
        </Card>
        <Pressable accessibilityRole="button" onPress={() => setServerOpen(true)} style={{ alignSelf: 'center', padding: 8 }}>
          <T mut size={12}>
            Serveur : {getServer()} · modifier
          </T>
        </Pressable>
      </Screen>

      <Sheet open={serverOpen} onClose={() => setServerOpen(false)} title="Adresse du serveur">
        <View style={{ gap: 12 }}>
          <Field label="Adresse de l’API (sans /api/v1)" value={server} onChangeText={setServerField} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Note>
            Émulateur Android : http://10.0.2.2:3000 (l’ordinateur). Téléphone sur le même Wi-Fi : http://IP-du-PC:3000. En ligne : l’adresse https du club.
          </Note>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              onPress={async () => {
                setServer(server);
                setServerField(normalizeServer(server));
                setServerOpen(false);
                try {
                  await api.get('/health');
                  toast('Serveur joignable.');
                } catch (e) {
                  toast(errorMessage(e));
                }
              }}
            >
              Enregistrer
            </Button>
            <Button onPress={() => setServerField(DEFAULT_SERVER)}>Par défaut</Button>
          </View>
        </View>
      </Sheet>
      <ForgotSheet open={forgotOpen} onClose={() => setForgotOpen(false)} initialEmail={email} />
    </KeyboardAvoidingView>
  );
}

/** Mot de passe oublié : code à 6 chiffres reçu par email, puis nouveau mot de passe. */
function ForgotSheet({ open, onClose, initialEmail }: { open: boolean; onClose: () => void; initialEmail: string }) {
  const toast = useToast();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Mot de passe oublié">
      <View style={{ gap: 12 }}>
        {step === 'email' ? (
          <>
            <Field label="Email du compte" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <Button
              variant="primary"
              loading={pending}
              onPress={() =>
                run(async () => {
                  await api.post('/auth/forgot-password', { email: email.trim() });
                  toast('Si ce compte existe, un code a été envoyé par email.');
                  setStep('code');
                })
              }
            >
              Recevoir un code
            </Button>
          </>
        ) : (
          <>
            <Field label="Code reçu (6 chiffres)" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
            <Field label="Nouveau mot de passe (10 caractères, lettres et chiffres)" value={password} onChangeText={setPassword} secureTextEntry />
            <Button
              variant="primary"
              loading={pending}
              onPress={() =>
                run(async () => {
                  await api.post('/auth/reset-password', { email: email.trim(), code: code.trim(), newPassword: password });
                  toast('Mot de passe modifié : connectez-vous.');
                  setStep('email');
                  onClose();
                })
              }
            >
              Changer le mot de passe
            </Button>
          </>
        )}
        <T mut size={12} style={{ fontFamily: FONT.regular }}>
          Compte sans email : demandez de nouveaux identifiants à l’administration du club.
        </T>
      </View>
    </Sheet>
  );
}
