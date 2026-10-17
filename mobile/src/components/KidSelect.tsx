import { Pressable, Text, View } from 'react-native';
import { useAuth, useMe } from '../auth/AuthContext';
import { FONT, useTheme } from '../lib/theme';

/** Parent : choix du joueur suivi, en haut de chaque module (puces). Rien pour les autres rôles. */
export function KidSelect() {
  const me = useMe();
  const { t } = useTheme();
  const { playerId, setPlayerId } = useAuth();
  if (me.role !== 'PARENT' || me.players.length < 2) return null;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Choisir le joueur" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {me.players.map((p) => {
        const on = p.id === playerId;
        return (
          <Pressable
            key={p.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => setPlayerId(p.id)}
            style={{ backgroundColor: on ? '#222' : t.fld, borderRadius: 99, paddingHorizontal: 16, paddingVertical: 9 }}
          >
            <Text style={{ fontFamily: FONT.medium, fontSize: 14, color: on ? '#fff' : t.fg }}>{p.firstName}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
