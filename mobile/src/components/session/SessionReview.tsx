import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, CardRow, CardTitle, Divider, Field, Pill, Pills, ProgressBar, QueryState, Segmented, Sheet, T } from '../ui';
import { api } from '../../lib/api';
import { FONT, PILL } from '../../lib/theme';
import type { Mood, SessionRatingNotes, SessionReview } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { Chip, Chips, Dots, Label, nb } from './common';

/** Points travaillés proposés (choix rapide) ; l'entraîneur peut aussi écrire le sien. */
export const OBJECTIVES = [
  'Coup droit',
  'Revers',
  'Service',
  'Retour de service',
  'Volée',
  'Smash',
  'Jeu de jambes',
  'Coordination',
  'Match à thème',
  'Physique',
];

/** Les 5 critères notés à chaque séance. */
export const CRITERIA: { key: keyof SessionRatingNotes; label: string }[] = [
  { key: 'effort', label: 'Engagement' },
  { key: 'focus', label: 'Concentration' },
  { key: 'behavior', label: 'Comportement' },
  { key: 'objective', label: 'Objectif du jour' },
  { key: 'play', label: 'Qualité de jeu' },
];

export const MOODS: { value: Mood; label: string }[] = [
  { value: 'GOOD', label: '🙂 En forme' },
  { value: 'TIRED', label: '😐 Fatigué' },
  { value: 'PAIN', label: '🙁 Douleur' },
];

const reviewKey = (slotId: string, date: string) => ['session-review', slotId, date];

export function useSessionReview(slotId: string, date: string) {
  return useQuery({ queryKey: reviewKey(slotId, date), queryFn: () => api.get<SessionReview>('/sessions/review', { slotId, date }) });
}

/** Carte « Objectif de la séance » : choix rapide ou texte libre, déroulé facultatif. */
export function SessionPlanCard({ slotId, date }: { slotId: string; date: string }) {
  const q = useSessionReview(slotId, date);
  return (
    <Card>
      <CardTitle>Objectif de la séance</CardTitle>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {q.data && <PlanForm review={q.data} />}
      </QueryState>
    </Card>
  );
}

function PlanForm({ review }: { review: SessionReview }) {
  const [objective, setObjective] = useState(review.plan?.objective ?? '');
  const [content, setContent] = useState(review.plan?.content ?? '');
  useEffect(() => {
    setObjective(review.plan?.objective ?? '');
    setContent(review.plan?.content ?? '');
  }, [review.plan?.objective, review.plan?.content]);
  const save = useAction(
    () => api.put('/sessions/plan', { slotId: review.slotId, date: review.date, objective: objective.trim(), content: content.trim() || undefined }),
    { invalidate: [reviewKey(review.slotId, review.date)], success: 'Objectif de la séance enregistré.' },
  );
  const dirty = objective !== (review.plan?.objective ?? '') || content !== (review.plan?.content ?? '');

  return (
    <View style={{ gap: 10 }}>
      <Chips label="Objectif de la séance">
        {OBJECTIVES.map((o) => (
          <Chip key={o} label={o} on={objective === o} onPress={() => setObjective(o)} />
        ))}
      </Chips>
      <Field label="Objectif (texte libre)" placeholder="Ou écrivez l’objectif : ex. coup droit croisé long" value={objective} maxLength={120} onChangeText={setObjective} />
      <Field
        label="Déroulé de la séance (facultatif)"
        multiline
        value={content}
        maxLength={1000}
        placeholder="Échauffement 10 min · panier coup droit croisé · jeu en 7 points · étirements"
        onChangeText={setContent}
      />
      <Button variant="primary" full onPress={() => save.mutate()} disabled={!objective.trim() || !dirty} loading={save.isPending}>
        Enregistrer l’objectif
      </Button>
    </View>
  );
}

/** Carte « Évaluation de la séance » : avancement et ouverture de la fenêtre d'évaluation (un joueur à la fois). */
export function SessionReviewCard({ slotId, date }: { slotId: string; date: string }) {
  const q = useSessionReview(slotId, date);
  const [open, setOpen] = useState<string | null>(null);
  const r = q.data;
  const rateable = r?.players.filter((p) => p.attendance === 'PRESENT' || p.attendance === 'LATE') ?? [];
  const done = rateable.filter((p) => p.rating).length;
  const next = rateable.find((p) => !p.rating) ?? rateable[0];

  return (
    <Card>
      <CardTitle>Évaluation de la séance</CardTitle>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {r && (
          <View style={{ gap: 10 }}>
            <Pills>
              {r.plan ? <Pill tone="b">{`Objectif : ${r.plan.objective}`}</Pill> : <Pill tone="s">Objectif à fixer</Pill>}
              {rateable.length > 0 && <Pill tone={done === rateable.length ? 'g' : 's'}>{`${done}/${rateable.length} évalué(s)`}</Pill>}
            </Pills>
            {!r.attendanceRecorded ? (
              <T size={13} mut>
                Pointez d’abord les présences : seuls les joueurs présents ou en retard sont évalués.
              </T>
            ) : rateable.length === 0 ? (
              <T size={13} mut>
                Aucun joueur présent à évaluer.
              </T>
            ) : (
              <>
                <ProgressBar value={done} max={rateable.length} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {rateable.map((p) => (
                    <Pressable
                      key={p.playerId}
                      accessibilityRole="button"
                      accessibilityLabel={`Évaluer ${p.firstName} ${p.lastName}`}
                      onPress={() => setOpen(p.playerId)}
                      style={{ backgroundColor: p.rating ? PILL.g : PILL.b, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 6 }}
                    >
                      <Text style={{ fontFamily: FONT.medium, fontSize: 13, color: '#111' }}>
                        {`${p.firstName} · ${p.rating ? `${nb(p.rating.average)}/5` : 'à évaluer'}`}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {r.editable && next && (
                  <Button variant={done === rateable.length ? 'secondary' : 'primary'} full onPress={() => setOpen(next.playerId)}>
                    {done === rateable.length ? 'Revoir les notes' : done ? 'Continuer l’évaluation' : 'Évaluer la séance'}
                  </Button>
                )}
              </>
            )}
            {open && <RatingSheet review={r} playerId={open} onPlayer={setOpen} onClose={() => setOpen(null)} />}
          </View>
        )}
      </QueryState>
    </Card>
  );
}

type Draft = SessionRatingNotes & { mood: Mood; comment: string };
const EMPTY: Draft = { effort: 0, focus: 0, behavior: 0, objective: 0, play: 0, mood: 'GOOD', comment: '' };

/** Feuille d'évaluation : 5 notes, forme du jour, commentaire pour le parent ; « suivant » enregistre et passe au joueur suivant. */
function RatingSheet({ review, playerId, onPlayer, onClose }: { review: SessionReview; playerId: string; onPlayer: (id: string) => void; onClose: () => void }) {
  const list = review.players.filter((p) => p.attendance === 'PRESENT' || p.attendance === 'LATE');
  const pos = list.findIndex((p) => p.playerId === playerId);
  const player = list[pos];
  const [draft, setDraft] = useState<Draft>(EMPTY);
  useEffect(() => {
    const r = player?.rating;
    setDraft(r ? { effort: r.effort, focus: r.focus, behavior: r.behavior, objective: r.objective, play: r.play, mood: r.mood, comment: r.comment ?? '' } : EMPTY);
  }, [player?.playerId, player?.rating]);

  const complete = CRITERIA.every((c) => draft[c.key] >= 1);
  const last = pos === list.length - 1;
  const save = useAction(
    () =>
      api.put<{ average: number }>('/sessions/ratings', {
        slotId: review.slotId,
        date: review.date,
        playerId,
        effort: draft.effort,
        focus: draft.focus,
        behavior: draft.behavior,
        objective: draft.objective,
        play: draft.play,
        mood: draft.mood,
        comment: draft.comment.trim() || undefined,
      }),
    {
      invalidate: [reviewKey(review.slotId, review.date)],
      success: last ? 'Évaluation de la séance terminée.' : undefined,
      onSuccess: () => (last ? onClose() : onPlayer(list[pos + 1].playerId)),
    },
  );
  if (!player) return null;
  const average = complete ? CRITERIA.reduce((s, c) => s + draft[c.key], 0) / CRITERIA.length : null;

  return (
    <Sheet open onClose={onClose} title={`Évaluation · ${player.firstName} ${player.lastName}`}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <Pills>
          <Pill tone="b">{`Joueur ${pos + 1}/${list.length}`}</Pill>
          <Pill tone="b">{review.group.name}</Pill>
          {player.attendance === 'LATE' && <Pill tone="s">En retard</Pill>}
          {average !== null && <Pill tone="g">{`Moyenne ${nb(average)}/5`}</Pill>}
          {!review.editable && <Pill tone="r">Lecture seule</Pill>}
        </Pills>
        {CRITERIA.map((c) => (
          <View key={c.key} style={{ gap: 6 }}>
            <T size={14} mut>
              {c.key === 'objective' && review.plan ? `Objectif : ${review.plan.objective}` : c.label}
            </T>
            <Dots label={c.label} value={draft[c.key]} disabled={!review.editable} onChange={(v) => setDraft((d) => ({ ...d, [c.key]: v }))} />
          </View>
        ))}
        <Divider />
        <View style={{ gap: 6 }}>
          <Label>Forme du jour</Label>
          <Segmented<Mood> label="Forme du jour" value={draft.mood} options={MOODS} disabled={!review.editable} onChange={(mood) => setDraft((d) => ({ ...d, mood }))} />
        </View>
        {draft.mood === 'PAIN' && <Pill tone="r">Douleur signalée : le parent et le directeur technique seront prévenus.</Pill>}
        <Field
          label="Commentaire pour le parent (facultatif) : un point fort, un point à travailler"
          multiline
          value={draft.comment}
          maxLength={500}
          editable={review.editable}
          onChangeText={(comment) => setDraft((d) => ({ ...d, comment }))}
        />
        <CardRow>
          <Button onPress={() => onPlayer(list[pos - 1].playerId)} disabled={pos === 0}>
            ‹ Précédent
          </Button>
          {review.editable ? (
            <Button variant="primary" onPress={() => save.mutate()} disabled={!complete} loading={save.isPending}>
              {last ? 'Enregistrer et terminer' : 'Enregistrer et suivant ›'}
            </Button>
          ) : (
            <Button onPress={() => (last ? onClose() : onPlayer(list[pos + 1].playerId))}>{last ? 'Fermer' : 'Suivant ›'}</Button>
          )}
        </CardRow>
      </View>
    </Sheet>
  );
}
