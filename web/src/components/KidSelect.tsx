import { useAuth, useMe } from '../auth/AuthContext';
import { FilterSelect } from './ui/Field';

/** Parent : liste de sélection du joueur suivi, en haut de chaque module. Rien pour les autres rôles. */
export function KidSelect() {
  const me = useMe();
  const { playerId, setPlayerId } = useAuth();
  if (me.role !== 'PARENT' || me.players.length === 0) return null;
  return (
    <FilterSelect label="Choisir le joueur" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
      {me.players.map((p) => (
        <option key={p.id} value={p.id}>
          {p.firstName} {p.lastName}
        </option>
      ))}
    </FilterSelect>
  );
}
