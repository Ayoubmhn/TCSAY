import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Mood, SessionRatingNotes, SessionReview } from '../lib/types';
import { useAction } from '../lib/useAction';
import { Button } from './ui/Button';
import { TextArea } from './ui/Field';
import { ProgressBar } from './ui/InstallmentCard';
import { QueryState } from './ui/Loading';
import { Modal } from './ui/Modal';
import { Pill, Pills } from './ui/Pill';
import { Segmented } from './ui/Segmented';

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

/** Objectif de la séance : choix rapide ou texte libre, déroulé facultatif. */
export function SessionPlanForm({ review }: { review: SessionReview }) {
  const [objective, setObjective] = useState(review.plan?.objective ?? '');
  const [content, setContent] = useState(review.plan?.content ?? '');
  useEffect(() => {
    setObjective(review.plan?.objective ?? '');
    setContent(review.plan?.content ?? '');
  }, [review.plan?.objective, review.plan?.content]);
  const save = useAction(
    () => api.put('/sessions/plan', { slotId: review.slotId, date: review.date, objective, content: content.trim() || undefined }),
    { invalidate: [reviewKey(review.slotId, review.date)], success: 'Objectif de la séance enregistré.' },
  );
  const dirty = objective !== (review.plan?.objective ?? '') || content !== (review.plan?.content ?? '');

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Objectif de la séance">
        {OBJECTIVES.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={objective === o}
            onClick={() => setObjective(o)}
            className={`rounded-full px-3.5 py-2 text-sm ${objective === o ? 'bg-sel text-white' : 'bg-fld text-fg'}`}
          >
            {o}
          </button>
        ))}
      </div>
      <input
        className="fld text-[15px] text-fg"
        aria-label="Objectif (texte libre)"
        placeholder="Ou écrivez l’objectif : ex. coup droit croisé long"
        value={objective}
        maxLength={120}
        onChange={(e) => setObjective(e.target.value)}
      />
      <TextArea
        label="Déroulé de la séance (facultatif)"
        value={content}
        maxLength={1000}
        placeholder="Échauffement 10 min · panier coup droit croisé · jeu en 7 points · étirements"
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => save.mutate()} disabled={!objective.trim() || !dirty || save.isPending}>
          Enregistrer l’objectif
        </Button>
      </div>
    </div>
  );
}

/** Carte « Évaluation de la séance » : avancement et ouverture de la fenêtre d'évaluation. */
export function SessionReviewCard({ slotId, date }: { slotId: string; date: string }) {
  const q = useSessionReview(slotId, date);
  const [open, setOpen] = useState<string | null>(null);
  const r = q.data;
  const rateable = r?.players.filter((p) => p.attendance === 'PRESENT' || p.attendance === 'LATE') ?? [];
  const done = rateable.filter((p) => p.rating).length;
  const next = rateable.find((p) => !p.rating) ?? rateable[0];

  return (
    <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
      {r && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {r.plan ? <Pill tone="b">Objectif : {r.plan.objective}</Pill> : <Pill tone="s">Objectif à fixer</Pill>}
            {rateable.length > 0 && <Pill tone={done === rateable.length ? 'g' : 's'}>{done}/{rateable.length} évalué(s)</Pill>}
          </div>
          {!r.attendanceRecorded ? (
            <span className="text-[13px] text-mut">Pointez d’abord les présences : seuls les joueurs présents ou en retard sont évalués.</span>
          ) : rateable.length === 0 ? (
            <span className="text-[13px] text-mut">Aucun joueur présent à évaluer.</span>
          ) : (
            <>
              <ProgressBar value={done} max={rateable.length} />
              <Pills>
                {rateable.map((p) => (
                  <button
                    key={p.playerId}
                    type="button"
                    onClick={() => setOpen(p.playerId)}
                    className={`rounded-full px-[13px] py-[5px] text-[13px] text-ink ${p.rating ? 'bg-pg' : 'bg-pb'}`}
                  >
                    {p.firstName} · {p.rating ? `${p.rating.average.toLocaleString('fr-FR')}/5` : 'à évaluer'}
                  </button>
                ))}
              </Pills>
              {r.editable && next && (
                <div className="flex justify-end">
                  <Button variant={done === rateable.length ? 'secondary' : 'primary'} onClick={() => setOpen(next.playerId)}>
                    {done === rateable.length ? 'Revoir les notes' : done ? 'Continuer l’évaluation' : 'Évaluer la séance'}
                  </Button>
                </div>
              )}
            </>
          )}
          {open && <SessionRatingModal review={r} playerId={open} onPlayer={setOpen} onClose={() => setOpen(null)} />}
        </div>
      )}
    </QueryState>
  );
}

/** Notes de 1 à 5 (boutons ronds). */
export function Dots({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={value === n}
          aria-label={`${label} : ${n} sur 5`}
          disabled={disabled}
          onClick={() => onChange(n)}
          className={`grid h-9 w-9 place-items-center rounded-full text-sm font-semibold ${value === n ? 'bg-pri text-white' : 'bg-fld text-fg'}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

type Draft = SessionRatingNotes & { mood: Mood; comment: string };
const EMPTY: Draft = { effort: 0, focus: 0, behavior: 0, objective: 0, play: 0, mood: 'GOOD', comment: '' };

/**
 * Fenêtre d'évaluation (séparée de la feuille de présence) : un joueur à la fois,
 * 5 notes, forme du jour, commentaire pour le parent ; « Suivant » enregistre et passe au joueur suivant.
 */
export function SessionRatingModal({
  review,
  playerId,
  onPlayer,
  onClose,
}: {
  review: SessionReview;
  playerId: string;
  onPlayer: (id: string) => void;
  onClose: () => void;
}) {
  const list = review.players.filter((p) => p.attendance === 'PRESENT' || p.attendance === 'LATE');
  const pos = list.findIndex((p) => p.playerId === playerId);
  const player = list[pos];
  const [draft, setDraft] = useState<Draft>(EMPTY);
  useEffect(() => {
    const r = player?.rating;
    setDraft(r ? { ...r, comment: r.comment ?? '' } : EMPTY);
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
  const average = complete ? CRITERIA.reduce((t, c) => t + draft[c.key], 0) / CRITERIA.length : null;

  return (
    <Modal
      open
      size="lg"
      title={`Évaluation · ${player.firstName} ${player.lastName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={() => onPlayer(list[pos - 1].playerId)} disabled={pos === 0}>
            ‹ Précédent
          </Button>
          {review.editable ? (
            <Button variant="primary" data-primary onClick={() => save.mutate()} disabled={!complete || save.isPending}>
              {last ? 'Enregistrer et terminer' : 'Enregistrer et suivant ›'}
            </Button>
          ) : (
            <Button onClick={() => (last ? onClose() : onPlayer(list[pos + 1].playerId))}>{last ? 'Fermer' : 'Suivant ›'}</Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Pills>
          <Pill tone="b">
            Joueur {pos + 1}/{list.length}
          </Pill>
          <Pill tone="b">{review.group.name}</Pill>
          {player.attendance === 'LATE' && <Pill tone="s">En retard</Pill>}
          {average !== null && <Pill tone="g">Moyenne {average.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/5</Pill>}
          {!review.editable && <Pill tone="r">Lecture seule</Pill>}
        </Pills>
        <div className="grid grid-cols-1 items-center gap-x-4 gap-y-2.5 min-[561px]:grid-cols-[170px_1fr]">
          {CRITERIA.map((c) => (
            <div key={c.key} className="contents">
              <span className="text-sm text-mut">
                {c.key === 'objective' && review.plan ? `Objectif : ${review.plan.objective}` : c.label}
              </span>
              <Dots label={c.label} value={draft[c.key]} disabled={!review.editable} onChange={(v) => setDraft((d) => ({ ...d, [c.key]: v }))} />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-sm text-mut">Forme du jour</span>
          <Segmented<Mood> label="Forme du jour" value={draft.mood} options={MOODS} onChange={(mood) => review.editable && setDraft((d) => ({ ...d, mood }))} />
        </div>
        {draft.mood === 'PAIN' && <Pill tone="r">Douleur signalée : le parent et le directeur technique seront prévenus.</Pill>}
        <TextArea
          label="Commentaire pour le parent (facultatif) : un point fort, un point à travailler"
          value={draft.comment}
          maxLength={500}
          disabled={!review.editable}
          onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
        />
      </div>
    </Modal>
  );
}
