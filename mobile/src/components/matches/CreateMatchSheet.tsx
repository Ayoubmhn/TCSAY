import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '../../lib/api';
import { addDays, fDLong, todayIso } from '../../lib/format';
import { useAction } from '../../lib/useAction';
import { useTheme } from '../../lib/theme';
import { Button, Field, Segmented, Sheet, T } from '../ui';
import { CheckRow } from './common';
import type { ClubPlayer, MatchKind } from './types';

const EXT = 'EXT';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Choix d'un joueur : du club (recherche dans la liste) ou « Saisir un nom (hors club)… ». Liste dépliée dans la feuille. */
function PlayerPicker({
  label,
  value,
  onChange,
  players,
  exclude,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  players: ClubPlayer[];
  exclude?: string;
}) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const current = value === EXT ? 'Saisir un nom (hors club)…' : (players.find((p) => p.id === value)?.name ?? '—');
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const list = players.filter((p) => p.id !== exclude && norm(p.name).includes(norm(search.trim()))).slice(0, 30);
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setSearch('');
  };
  return (
    <View style={{ gap: 6 }}>
      <T size={12} mut w="medium">
        {label}
      </T>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} : ${current}`}
        onPress={() => setOpen(!open)}
        style={{ backgroundColor: t.fld, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <T style={{ flex: 1 }} numberOfLines={1}>
          {current}
        </T>
        <T mut size={12}>
          {open ? '▴' : '▾'}
        </T>
      </Pressable>
      {open && (
        <View style={{ borderWidth: 1.5, borderColor: t.line, borderRadius: 20, padding: 10, gap: 4 }}>
          <Field label="Rechercher" value={search} onChangeText={setSearch} placeholder="Nom du joueur" autoCorrect={false} />
          {list.map((p) => (
            <Pressable key={p.id} accessibilityRole="button" onPress={() => pick(p.id)} style={{ paddingVertical: 11, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: t.line }}>
              <T w={p.id === value ? 'semibold' : 'regular'}>{p.id === value ? `${p.name}  ✓` : p.name}</T>
            </Pressable>
          ))}
          {!list.length && (
            <T mut size={13} style={{ padding: 8 }}>
              Aucun joueur trouvé.
            </T>
          )}
          <Pressable accessibilityRole="button" onPress={() => pick(EXT)} style={{ paddingVertical: 11, paddingHorizontal: 8 }}>
            <T w="medium" color={t.pri}>
              Saisir un nom (hors club)…
            </T>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Création d'un match : type, joueurs (club ou adversaire extérieur), date, terrain, format. */
export function CreateMatchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const players = useQuery({ queryKey: ['match-players'], queryFn: () => api.get<ClubPlayer[]>('/matches/players'), enabled: open });
  const [kind, setKind] = useState<MatchKind>('INTERNAL');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayIso());
  const [court, setCourt] = useState('');
  const [a, setA] = useState('');
  const [aName, setAName] = useState('');
  const [b, setB] = useState('');
  const [bName, setBName] = useState('');
  const [setsToWin, setSetsToWin] = useState<'2' | '3'>('2');
  const [games, setGames] = useState<'6' | '4'>('6');
  const [superTB, setSuperTB] = useState(false);
  const [noAd, setNoAd] = useState(false);
  const [tiebreak, setTiebreak] = useState(true);

  const list = players.data ?? [];
  const aSel = a || list[0]?.id || EXT;
  const bSel = b || list.find((p) => p.id !== aSel)?.id || EXT;
  const side = (sel: string, name: string) => (sel === EXT ? { name: name.trim() } : { id: sel, name: undefined });

  const create = useAction(
    () =>
      api.post<{ id: string }>('/matches', {
        kind,
        title: title.trim() || undefined,
        date,
        court: court.trim() || undefined,
        playerAId: side(aSel, aName).id,
        playerAName: side(aSel, aName).name,
        playerBId: side(bSel, bName).id,
        playerBName: side(bSel, bName).name,
        setsToWin: Number(setsToWin),
        games: Number(games),
        tiebreak: tiebreak || superTB,
        superTB,
        noAd,
      }),
    {
      invalidate: [['matches']],
      success: 'Match créé.',
      onSuccess: (r) => {
        onClose();
        router.push(`/matchs/${r.id}` as never);
      },
    },
  );
  const validDate = ISO_DAY.test(date);
  const ready = (aSel !== EXT || aName.trim()) && (bSel !== EXT || bName.trim()) && (aSel === EXT || aSel !== bSel) && validDate;

  return (
    <Sheet open={open} onClose={onClose} title="Nouveau match">
      <View style={{ gap: 14, paddingTop: 6 }}>
        <View style={{ gap: 6 }}>
          <T size={12} mut w="medium">
            Type
          </T>
          <Segmented
            label="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'INTERNAL', label: 'Interne' },
              { value: 'FRIENDLY', label: 'Amical' },
              { value: 'TOURNAMENT', label: 'Tournoi' },
            ]}
          />
          {kind === 'FRIENDLY' && (
            <T mut size={12}>
              Match amical : adversaire extérieur.
            </T>
          )}
        </View>
        <Field label="Tournoi, tour (facultatif)" value={title} maxLength={80} onChangeText={setTitle} placeholder="ex. Open de Sayada U14 · quart" />
        <PlayerPicker label="Joueur A" value={aSel} onChange={setA} players={list} />
        {aSel === EXT && <Field label="Nom du joueur A" value={aName} maxLength={80} onChangeText={setAName} placeholder="ex. Karim Jaziri (CT Monastir)" />}
        <PlayerPicker label="Joueur B" value={bSel} onChange={setB} players={list} exclude={aSel === EXT ? undefined : aSel} />
        {bSel === EXT && <Field label="Nom du joueur B" value={bName} maxLength={80} onChangeText={setBName} placeholder="ex. Lina Haddad (ES Sahel)" />}
        <View style={{ gap: 8 }}>
          <Field
            label="Date (AAAA-MM-JJ)"
            value={date}
            onChangeText={setDate}
            maxLength={10}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            error={validDate ? null : 'Date au format AAAA-MM-JJ.'}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Button onPress={() => setDate(todayIso())}>Aujourd’hui</Button>
            <Button onPress={() => setDate(addDays(todayIso(), 1))}>Demain</Button>
            {validDate && (
              <T mut size={13}>
                {fDLong(date)}
              </T>
            )}
          </View>
        </View>
        <Field label="Terrain (facultatif)" value={court} maxLength={40} onChangeText={setCourt} placeholder="ex. Court 2" />
        <View style={{ gap: 6 }}>
          <T size={12} mut w="medium">
            Sets gagnants
          </T>
          <Segmented
            label="Sets gagnants"
            value={setsToWin}
            onChange={setSetsToWin}
            options={[
              { value: '2', label: '2 sets gagnants' },
              { value: '3', label: '3 sets gagnants' },
            ]}
          />
        </View>
        <View style={{ gap: 6 }}>
          <T size={12} mut w="medium">
            Jeux par set
          </T>
          <Segmented
            label="Jeux par set"
            value={games}
            onChange={setGames}
            options={[
              { value: '6', label: '6 jeux' },
              { value: '4', label: '4 jeux (jeunes)' },
            ]}
          />
        </View>
        <View style={{ gap: 6 }}>
          <T size={12} mut w="medium">
            Dernier set
          </T>
          <Segmented
            label="Dernier set"
            value={superTB ? '1' : '0'}
            onChange={(v) => setSuperTB(v === '1')}
            options={[
              { value: '0', label: 'Set normal' },
              { value: '1', label: 'Super tie-break à 10' },
            ]}
          />
        </View>
        <View>
          <CheckRow label="Tie-break à égalité de jeux" checked={tiebreak || superTB} disabled={superTB} onChange={setTiebreak} />
          <CheckRow label="Point décisif à 40-40" checked={noAd} onChange={setNoAd} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingBottom: 8 }}>
          <Button onPress={onClose}>Annuler</Button>
          <Button variant="primary" onPress={() => create.mutate()} disabled={!ready} loading={create.isPending}>
            Créer le match
          </Button>
        </View>
      </View>
    </Sheet>
  );
}
