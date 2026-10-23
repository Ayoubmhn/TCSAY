import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../../auth/AuthContext';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { SelectField, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { DT, fD } from '../../lib/format';
import type { Player } from '../../lib/types';
import { useModule } from '../../lib/modules';
import { useAction } from '../../lib/useAction';

type Module = 'sessions' | 'progress' | 'exercises' | 'reservation';
type Config = { enabled: boolean; graceDays: number; modules: Record<Module, boolean>; labels: Record<Module, string> };
type Locked = {
  enabled: boolean;
  players: { id: string; name: string; code: string | null; exempt: string | null; installment: string | null; dueDate: string | null; remaining: number }[];
};
const MODULES: Module[] = ['sessions', 'progress', 'exercises', 'reservation'];

/**
 * Accès après paiement : le président choisit les modules fermés au joueur et au parent tant qu'une tranche échue n'est pas
 * payée (après un délai de grâce) ; exceptions par joueur avec motif. Paiements, reçus et notifications restent ouverts.
 */
export function PaymentAccessPage() {
  // Modules coupés (version du club) : pas proposés ici.
  const progressOn = useModule(['evaluation-seances', 'bilans']);
  const exercisesOn = useModule('exercices');
  const me = useMe();
  const president = me.permissions.includes('permissions.manage');
  const cfg = useQuery({ queryKey: ['access-config'], queryFn: () => api.get<Config>('/access/payment/config') });
  const locked = useQuery({ queryKey: ['access-locked'], queryFn: () => api.get<Locked>('/access/payment/locked') });
  const [draft, setDraft] = useState<Omit<Config, 'labels'>>();
  useEffect(() => {
    if (cfg.data) setDraft({ enabled: cfg.data.enabled, graceDays: cfg.data.graceDays, modules: { ...cfg.data.modules } });
  }, [cfg.data]);
  const [exempting, setExempting] = useState<{ id: string; name: string }>();
  const [search, setSearch] = useState('');
  const found = useQuery({
    queryKey: ['players', 'exemption', search],
    queryFn: () => api.get<Player[]>('/players', { q: search.trim() }),
    enabled: search.trim().length >= 2,
  });

  const save = useAction(() => api.put('/access/payment/config', draft), {
    invalidate: [['access-config'], ['access-locked'], ['access-status']],
    success: 'Réglage enregistré.',
  });
  const exemption = useAction(({ playerId, reason }: { playerId: string; reason?: string }) => api.put('/access/payment/exemption', { playerId, reason }), {
    invalidate: [['access-locked'], ['access-status']],
    success: 'Exception mise à jour.',
    onSuccess: () => setExempting(undefined),
  });
  const dirty = cfg.data && draft && JSON.stringify(draft) !== JSON.stringify({ enabled: cfg.data.enabled, graceDays: cfg.data.graceDays, modules: cfg.data.modules });

  return (
    <>
      <PageHeader
        title="Accès après paiement"
        subtitle="Découvrez ce qui est fermé aux familles tant qu’une tranche échue n’est pas payée."
        action={cfg.data && <Pill tone={cfg.data.enabled ? 'g' : 's'}>{cfg.data.enabled ? 'Activé' : 'Désactivé'}</Pill>}
      />
      <QueryState isPending={cfg.isPending} error={cfg.error} refetch={cfg.refetch}>
        {cfg.data && draft && (
          <Section title="Réglage">
            <Card>
              <label className="flex items-center gap-2.5 font-medium">
                <input type="checkbox" checked={draft.enabled} disabled={!president} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                Fermer l’accès des familles quand une tranche est en retard
              </label>
              <div className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-2">
                <SelectField
                  label="Délai de grâce après l’échéance"
                  value={draft.graceDays}
                  disabled={!president}
                  onChange={(e) => setDraft({ ...draft, graceDays: Number(e.target.value) })}
                >
                  {[0, 3, 7, 15, 30].map((d) => (
                    <option key={d} value={d}>
                      {d ? `${d} jours` : 'Aucun'}
                    </option>
                  ))}
                </SelectField>
              </div>
              <div className="flex flex-col gap-2">
                {MODULES.filter((m) => (m === 'progress' ? progressOn : m === 'exercises' ? exercisesOn : true)).map((m) => (
                  <label key={m} className="flex items-center justify-between gap-3 rounded-[18px] bg-fld px-4 py-2.5 text-sm">
                    <span>{cfg.data!.labels[m]}</span>
                    <span className="flex items-center gap-2">
                      <Pill tone={draft.modules[m] ? 'r' : 'g'}>{draft.modules[m] ? 'Fermé si impayé' : 'Toujours ouvert'}</Pill>
                      <input
                        type="checkbox"
                        aria-label={`Fermer : ${cfg.data!.labels[m]}`}
                        checked={draft.modules[m]}
                        disabled={!president}
                        onChange={(e) => setDraft({ ...draft, modules: { ...draft.modules, [m]: e.target.checked } })}
                      />
                    </span>
                  </label>
                ))}
                <div className="flex items-center justify-between gap-3 rounded-[18px] bg-fld px-4 py-2.5 text-sm">
                  <span>Paiements, reçus et notifications</span>
                  <Pill tone="g">Toujours ouvert</Pill>
                </div>
              </div>
              {president && (
                <CardActions>
                  <Button variant="primary" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                    Enregistrer le réglage
                  </Button>
                </CardActions>
              )}
            </Card>
          </Section>
        )}
      </QueryState>

      <Section title="Joueurs concernés">
        <QueryState isPending={locked.isPending} error={locked.error} refetch={locked.refetch}>
          {locked.data?.players.length ? (
            <CardGrid list>
              {locked.data.players.map((p) => (
                <Card key={p.id}>
                  <CardRow>
                    <h3>
                      <Link to={`/admin/joueurs/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </h3>
                  </CardRow>
                  <Pills>
                    {p.code && <Pill tone="s">{p.code}</Pill>}
                    {p.exempt ? (
                      <Pill tone="g">Exception : {p.exempt}</Pill>
                    ) : locked.data!.enabled ? (
                      <Pill tone="r">Accès fermé</Pill>
                    ) : (
                      <Pill tone="s">Serait fermé</Pill>
                    )}
                  </Pills>
                  <CardText>
                    {p.installment && p.dueDate ? `Tranche ${p.installment} échue le ${fD(p.dueDate, { day: 'numeric', month: 'short' })} : ${DT(p.remaining)} restant` : 'À jour'}
                  </CardText>
                  <CardActions>
                    {p.exempt ? (
                      <ActionIcon kind="restore" label="Retirer l’exception" onClick={() => exemption.mutate({ playerId: p.id })} />
                    ) : (
                      <ActionIcon kind="activate" label="Accorder une exception (motif)" onClick={() => setExempting(p)} />
                    )}
                  </CardActions>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun joueur en retard de paiement au-delà du délai de grâce.</EmptyState>
          )}
        </QueryState>
      </Section>
      <Section title="Ajouter une exception">
        <div className="max-w-[420px]">
          <TextField label="Rechercher un joueur (nom ou code TCSAY)" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ex. Hammami" />
        </div>
        {search.trim().length >= 2 && (
          <div className="mt-3">
            <QueryState isPending={found.isPending} error={found.error} refetch={found.refetch}>
              {found.data?.length ? (
                <CardGrid list>
                  {found.data.slice(0, 8).map((p) => {
                    const name = `${p.firstName} ${p.lastName}`.trim();
                    const already = locked.data?.players.find((x) => x.id === p.id)?.exempt;
                    return (
                      <Card key={p.id}>
                        <CardRow>
                          <h3>{name}</h3>
                        </CardRow>
                        <Pills>{already ? <Pill tone="g">Exception : {already}</Pill> : <Pill tone="s">Sans exception</Pill>}</Pills>
                        <CardActions>
                          {already ? (
                            <ActionIcon kind="restore" label="Retirer l’exception" onClick={() => exemption.mutate({ playerId: p.id })} />
                          ) : (
                            <ActionIcon kind="add" primary label="Accorder une exception (motif)" onClick={() => setExempting({ id: p.id, name })} />
                          )}
                        </CardActions>
                      </Card>
                    );
                  })}
                </CardGrid>
              ) : (
                <EmptyState>Aucun joueur trouvé.</EmptyState>
              )}
            </QueryState>
          </div>
        )}
      </Section>
      <Note>
        L’entraîneur garde toujours le joueur dans ses présences et ses évaluations : seul l’affichage côté famille est fermé.
        Le réglage revient au président ; une exception (exonération, accord du bureau) se donne avec un motif et figure dans
        l’historique.
      </Note>
      <ConfirmModal
        open={Boolean(exempting)}
        title="Accorder une exception ?"
        text={`${exempting?.name ?? ''} gardera l’accès même avec une tranche en retard.`}
        cta="Accorder"
        withMotif
        pending={exemption.isPending}
        onConfirm={(reason) => exempting && exemption.mutate({ playerId: exempting.id, reason })}
        onClose={() => setExempting(undefined)}
      />
    </>
  );
}
