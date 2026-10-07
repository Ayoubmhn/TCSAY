import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState, Kpi } from '../../components/ui/Card';
import { FormGrid, SelectField, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { DT, fD, fullName } from '../../lib/format';
import type { Coach, Salary } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function currentPeriod(): string {
  const now = new Date();
  return `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

function SalaryFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const coaches = useQuery({ queryKey: ['coaches'], queryFn: () => api.get<Coach[]>('/coaches'), enabled: open });
  const [coachId, setCoachId] = useState('');
  const [period, setPeriod] = useState(currentPeriod());
  const [amount, setAmount] = useState('');
  useEffect(() => {
    if (open) {
      setCoachId('');
      setPeriod(currentPeriod());
      setAmount('');
    }
  }, [open]);
  const save = useAction(() => api.post('/salaries', { coachId, period, amount: Number(amount) }), {
    invalidate: [['salaries']],
    success: 'Salaire saisi.',
    onSuccess: onClose,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!coachId) return toast('Entraîneur obligatoire.');
    if (!period.trim()) return toast('Période obligatoire (ex. Octobre 2026).');
    if (amount === '' || !(Number(amount) >= 0)) return toast('Montant invalide.');
    save.mutate();
  };
  return (
    <Modal
      open={open}
      title="Saisir un salaire"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="salary-form" disabled={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <FormGrid id="salary-form" onSubmit={submit}>
        <SelectField label="Entraîneur" full value={coachId} onChange={(e) => setCoachId(e.target.value)}>
          <option value="">— Choisir —</option>
          {coaches.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {fullName(c)}
            </option>
          ))}
        </SelectField>
        <TextField label="Période" value={period} onChange={(e) => setPeriod(e.target.value)} />
        <TextField label="Montant (DT)" type="number" min={0} step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </FormGrid>
    </Modal>
  );
}

/** Salaires (vSal) : saisis par l'admin, Versé / À verser. */
export function SalariesPage() {
  const q = useQuery({ queryKey: ['salaries'], queryFn: () => api.get<Salary[]>('/salaries') });
  const [open, setOpen] = useState(false);
  const pay = useAction((id: string) => api.post(`/salaries/${id}/pay`), {
    invalidate: [['salaries'], ['emails'], ['audit']],
    success: 'Salaire marqué versé.',
  });

  return (
    <>
      <PageHeader
        title="Salaires"
        subtitle="Découvrez les salaires des entraîneurs."
        action={
          <Button variant="primary" onClick={() => setOpen(true)}>
            + Saisir un salaire
          </Button>
        }
      />
      <div className="mt-5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {q.data?.length ? (
            <CardGrid>
              {q.data.map((s) => (
                <Card key={s.id}>
                  <CardRow>
                    <h3>{fullName(s.coach)}</h3>
                    <Pill tone={s.paid ? 'g' : 'r'}>{s.paid ? 'Versé' : 'À verser'}</Pill>
                  </CardRow>
                  <Pills>
                    <Pill tone="b">{s.period}</Pill>
                  </Pills>
                  <Kpi>{DT(s.amount)}</Kpi>
                  <CardActions>
                    {s.paid && s.paidAt ? (
                      <CardText>Versé le {fD(s.paidAt, { day: 'numeric', month: 'short' })}</CardText>
                    ) : (
                      <Button variant="primary" onClick={() => pay.mutate(s.id)} disabled={pay.isPending}>
                        Marquer versé
                      </Button>
                    )}
                  </CardActions>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun salaire saisi.</EmptyState>
          )}
        </QueryState>
      </div>
      <SalaryFormModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
