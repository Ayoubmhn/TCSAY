import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Button, Card, Field, Note, PageHeader, Screen } from '../components/ui';
import { api, errorMessage, passwordHint, setToken } from '../lib/api';
import { homeOf } from '../lib/nav';

/** Changement du mot de passe (vChangePw) : obligatoire à la première connexion, aussi depuis Paramètres. */
export default function ChangePasswordScreen() {
  const { me, refresh, logout } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  if (!me) return <Redirect href="/connexion" />;
  // On quitte l'écran une fois le profil relu (sinon la garde renverrait ici avec l'ancien état).
  if (done && !me.mustChangePassword) return <Redirect href={homeOf(me)} />;

  const hint = next ? passwordHint(next) : null;
  const submit = async () => {
    if (hint) return toast(hint);
    if (next !== confirm) return toast('La confirmation ne correspond pas.');
    setPending(true);
    try {
      const r = await api.post<{ accessToken?: string }>('/auth/change-password', { currentPassword: current, newPassword: next });
      if (r?.accessToken) setToken(r.accessToken);
      await refresh();
      toast('Mot de passe modifié.');
      setDone(true);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <PageHeader
          title="Nouveau mot de passe"
          subtitle={me.mustChangePassword ? 'Première connexion : choisissez votre mot de passe personnel.' : 'Changez votre mot de passe.'}
        />
        <Card>
          <Field label={me.mustChangePassword ? 'Mot de passe temporaire (reçu par email)' : 'Mot de passe actuel'} value={current} onChangeText={setCurrent} secureTextEntry />
          <Field label="Nouveau mot de passe (10 caractères, lettres et chiffres)" value={next} onChangeText={setNext} secureTextEntry error={hint} />
          <Field label="Confirmation" value={confirm} onChangeText={setConfirm} secureTextEntry />
          <Button variant="primary" full onPress={submit} loading={pending}>
            Changer le mot de passe
          </Button>
          {me.mustChangePassword ? (
            <Button onPress={logout}>Se déconnecter</Button>
          ) : (
            <Button onPress={() => router.back()}>Annuler</Button>
          )}
        </Card>
        <Note>Changer de mot de passe déconnecte vos autres appareils.</Note>
      </Screen>
    </KeyboardAvoidingView>
  );
}
