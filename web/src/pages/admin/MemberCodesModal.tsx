import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import type { MemberCodePlan } from '../../lib/types';
import { useAction } from '../../lib/useAction';

/**
 * Identifiants TCSAY (président) : aperçu du recalcul des codes provisoires (première saison réelle de chaque joueur),
 * recalcul, puis validation définitive une fois l'historique importé.
 */
export function MemberCodesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [confirm, setConfirm] = useState<'recompute' | 'finalize'>();
  const plan = useQuery({
    queryKey: ['member-codes-plan'],
    queryFn: () => api.get<MemberCodePlan>('/players/member-codes/plan'),
    enabled: open,
  });
  const done = { invalidate: [['players'], ['member-codes-plan'], ['player-profile']], onSuccess: () => setConfirm(undefined) };
  const recompute = useAction(() => api.post<{ updated: number; total: number }>('/players/member-codes/recompute'), {
    ...done,
    success: (r) => `${r.updated} code(s) modifié(s) sur ${r.total}.`,
  });
  const finalize = useAction(() => api.post<{ finalized: number }>('/players/member-codes/finalize'), {
    ...done,
    success: (r) => `${r.finalized} code(s) validé(s) définitivement.`,
  });
  const d = plan.data;

  return (
    <>
      <Modal
        open={open}
        size="lg"
        title="Identifiants TCSAY"
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Fermer</Button>
            <Button disabled={!d?.changes.length} onClick={() => setConfirm('recompute')}>
              Recalculer
            </Button>
            <Button variant="primary" disabled={!d?.provisional} onClick={() => setConfirm('finalize')}>
              Valider définitivement
            </Button>
          </>
        }
      >
        <QueryState isPending={plan.isPending} error={plan.error} refetch={plan.refetch}>
          {d && (
            <>
              <Pills>
                <Pill tone="s">{d.provisional} provisoire(s)</Pill>
                <Pill tone="g">{d.definitive} définitif(s)</Pill>
                <Pill tone={d.changes.length ? 'r' : 'g'}>{d.changes.length} à modifier</Pill>
              </Pills>
              {d.changes.length ? (
                <div className="flex max-h-[320px] flex-col gap-1.5 overflow-auto">
                  {d.changes.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] bg-fld px-4 py-2 text-sm">
                      <span>{c.name}</span>
                      <span className="tabular-nums">
                        {c.before ?? '—'} → <b className="font-semibold">{c.after}</b>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="m-0 text-sm text-mut">Les codes provisoires sont déjà à jour.</p>
              )}
            </>
          )}
        </QueryState>
        <Note>
          Recalcul : chaque joueur prend l’année de sa <b>première saison</b>, numérotée par ordre d’enregistrement. À faire
          après l’import des années précédentes. La <b>validation définitive</b> fige les codes : ils ne changeront plus jamais.
        </Note>
      </Modal>
      <ConfirmModal
        open={confirm === 'recompute'}
        title="Recalculer les codes provisoires ?"
        text={`${d?.changes.length ?? 0} code(s) vont changer. Les codes définitifs ne sont pas touchés.`}
        cta="Recalculer"
        pending={recompute.isPending}
        onConfirm={() => recompute.mutate()}
        onClose={() => setConfirm(undefined)}
      />
      <ConfirmModal
        open={confirm === 'finalize'}
        title="Valider définitivement les codes ?"
        text={`${d?.provisional ?? 0} code(s) deviendront définitifs. Action irréversible : à faire seulement quand tout l’historique est importé.`}
        cta="Valider"
        pending={finalize.isPending}
        onConfirm={() => finalize.mutate()}
        onClose={() => setConfirm(undefined)}
      />
    </>
  );
}
