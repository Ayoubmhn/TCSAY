import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardRow, CardText } from '../../components/ui/Card';
import { SelectField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { Pill } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import type { PaymentPlan } from '../../lib/types';
import { useAction } from '../../lib/useAction';

/**
 * Tout joueur inscrit paie sa cotisation : bandeau affiché quand des joueurs n'en ont pas encore (ex. importés du cahier),
 * avec création en une fois selon le mode choisi (modifiable ensuite joueur par joueur dans « Modifier »).
 */
export function MissingMemberships() {
  const q = useQuery({ queryKey: ['memberships-missing'], queryFn: () => api.get<{ count: number }>('/memberships/missing') });
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<PaymentPlan>('FULL');
  const [withoutFee, setWithoutFee] = useState<string[]>([]);
  const create = useAction(() => api.post<{ created: number; withoutFee: string[] }>('/memberships/missing', { paymentPlan: plan }), {
    invalidate: [['memberships-missing'], ['players'], ['installments'], ['dashboard']],
    success: (r) => `${r.created} cotisation(s) créée(s).`,
    onSuccess: (r) => {
      setOpen(false);
      setWithoutFee(r.withoutFee);
    },
  });
  const count = q.data?.count ?? 0;
  if (!count && !withoutFee.length) return null;

  return (
    <>
      {count > 0 && (
        <Card className="mt-2.5">
          <CardRow>
            <div className="flex min-w-0 flex-col gap-1">
              <h3>
                {count} joueur{count > 1 ? 's' : ''} inscrit{count > 1 ? 's' : ''} sans cotisation
              </h3>
              <CardText>Tout joueur doit payer sa cotisation. Créez-les en une fois, puis ajustez le mode de paiement joueur par joueur (« Modifier »).</CardText>
            </div>
            <Button variant="primary" onClick={() => setOpen(true)}>
              Créer les cotisations
            </Button>
          </CardRow>
        </Card>
      )}
      {withoutFee.length > 0 && (
        <Note>
          Aucun tarif d’entraînement pour : {withoutFee.join(', ')}. Créez le tarif de leur catégorie (Finances › Tarifs d’entraînement), puis relancez.
        </Note>
      )}
      <Modal
        open={open}
        title="Créer les cotisations manquantes"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Annuler</Button>
            <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
              Créer {count} cotisation{count > 1 ? 's' : ''}
            </Button>
          </>
        }
      >
        <SelectField label="Mode de paiement pour ces joueurs" value={plan} onChange={(e) => setPlan(e.target.value as PaymentPlan)}>
          <option value="FULL">Comptant (une seule tranche)</option>
          <option value="SEMESTER">Par semestre (acompte + 2 tranches)</option>
          <option value="MONTHLY">Par mois (acompte + une tranche par mois)</option>
        </SelectField>
        <Pill tone="s" className="whitespace-normal">
          Montants pris dans les tarifs d’entraînement de la saison (catégorie ou groupe de chaque joueur).
        </Pill>
      </Modal>
    </>
  );
}
