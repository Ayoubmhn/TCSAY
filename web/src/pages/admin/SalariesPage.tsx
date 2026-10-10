import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { EMPLOYEE_TYPE_LABEL, EstimateCard, SalaryCard, currentMonth, monthLabel, shiftMonth } from '../../components/SalaryParts';
import { Button } from '../../components/ui/Button';
import { CardGrid, EmptyState } from '../../components/ui/Card';
import { FilterSelect, Filters, FormGrid, TextArea, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { Segmented } from '../../components/ui/Segmented';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { DT } from '../../lib/format';
import type { Employee, EmployeeType, Estimate, Salary } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const TYPES: { value: EmployeeType; label: string }[] = [
  { value: 'COACH', label: 'Entraîneurs' },
  { value: 'ADMIN_AGENT', label: 'Agents administratifs' },
  { value: 'SUPERVISOR', label: 'Agent superviseur' },
  { value: 'TECH_DIRECTOR', label: 'Directeur technique' },
];
const KEYS = [['salaries'], ['salary-estimate'], ['audit'], ['coach-profile'], ['staff-profile']];

/** Modification d'un salaire non versé (R6 : motif obligatoire sur saison clôturée). */
function EditSalaryModal({ salary, onClose }: { salary?: Salary; onClose: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (salary) {
      setAmount(String(salary.amount));
      setReason('');
    }
  }, [salary]);
  const save = useAction(() => api.patch(`/salaries/${salary!.id}`, { version: salary!.version, amount: Number(amount), reason: reason.trim() || undefined }), {
    invalidate: KEYS,
    success: 'Salaire modifié.',
    onSuccess: onClose,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (amount === '' || !(Number(amount) >= 0)) return toast('Montant invalide.');
    save.mutate();
  };
  return (
    <Modal
      open={Boolean(salary)}
      title={salary ? `Modifier le salaire · ${monthLabel(salary.month)}` : ''}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="salary-edit" disabled={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <FormGrid id="salary-edit" onSubmit={submit}>
        <TextField label="Montant (DT)" full type="number" min={0} step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <TextArea label="Motif (obligatoire sur saison clôturée)" full value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormGrid>
    </Modal>
  );
}

/**
 * Salaires (vSal) : choix entraîneur / agent administratif / directeur technique, puis de la personne et du mois.
 * Le montant est proposé à partir des séances prévues et des absences validées (entraîneur), ou du forfait mensuel.
 */
export function SalariesPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const type = (params.get('type') as EmployeeType) || 'COACH';
  const employeeId = params.get('employe') ?? '';
  const [month, setMonth] = useState(currentMonth());
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<Salary>();

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  };

  const employees = useQuery({ queryKey: ['salaries', 'employees', type], queryFn: () => api.get<Employee[]>('/salaries/employees', { type }) });
  const employee = employees.data?.find((e) => e.id === employeeId);
  const list = useQuery({
    queryKey: ['salaries', 'list', type, employeeId],
    queryFn: () => api.get<Salary[]>('/salaries', { type, employeeId: employeeId || undefined }),
  });
  const estimate = useQuery({
    queryKey: ['salary-estimate', employeeId, month],
    queryFn: () => api.get<Estimate>('/salaries/estimate', { employeeId, month }),
    enabled: Boolean(employeeId),
  });
  useEffect(() => {
    setHours(estimate.data?.hours != null ? String(estimate.data.hours) : '');
    setNote('');
  }, [estimate.data]);

  const recorded = list.data?.find((s) => s.employee.id === employeeId && s.month === month);
  const hourly = estimate.data?.payMode === 'HOURLY';
  const preview = hourly && hours !== '' && estimate.data ? Math.round(Number(hours) * estimate.data.payRate * 1000) / 1000 : estimate.data?.amount;

  const save = useAction(
    () => api.post('/salaries', { employeeId, month, hours: hourly && hours !== '' ? Number(hours) : undefined, note: note.trim() || undefined }),
    { invalidate: KEYS, success: `Salaire de ${monthLabel(month)} enregistré.` },
  );
  const pay = useAction((id: string) => api.post(`/salaries/${id}/pay`), { invalidate: [...KEYS, ['emails']], success: 'Salaire marqué versé.' });

  const months = Array.from({ length: 15 }, (_, i) => shiftMonth(currentMonth(), 2 - i));
  const rows = list.data ?? [];
  const due = rows.filter((s) => !s.paid).reduce((t, s) => t + s.amount, 0);

  return (
    <>
      <PageHeader title="Salaires" subtitle="Découvrez les salaires des entraîneurs et du personnel." />
      <div className="mt-5">
        <Segmented label="Type de personnel" options={TYPES} value={type} onChange={(v) => update({ type: v, employe: '' })} />
      </div>
      <Filters>
        <FilterSelect label={EMPLOYEE_TYPE_LABEL[type]} value={employeeId} onChange={(e) => update({ employe: e.target.value })}>
          <option value="">Tous · {TYPES.find((t) => t.value === type)?.label.toLowerCase()}</option>
          {employees.data?.map((e) => (
            <option key={e.id} value={e.id}>
              {`${e.firstName} ${e.lastName}`.trim()}
              {e.isActive ? '' : ' (désactivé)'}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Mois" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </FilterSelect>
        {rows.length > 0 && <Pill tone={due ? 'r' : 'g'}>{due ? `${DT(due)} à verser` : 'Tout est versé'}</Pill>}
      </Filters>

      {employeeId && (
        <Section title={`Calcul de ${monthLabel(month)}${employee ? ` · ${`${employee.firstName} ${employee.lastName}`.trim()}` : ''}`}>
          <QueryState isPending={estimate.isPending} error={estimate.error} refetch={estimate.refetch}>
            {estimate.data && (
              <CardGrid>
                {recorded ? (
                  <SalaryCard salary={recorded}>
                    {!recorded.paid && (
                      <>
                        <Button variant="primary" onClick={() => pay.mutate(recorded.id)} disabled={pay.isPending}>
                          Marquer versé
                        </Button>
                        <Button onClick={() => setEditing(recorded)}>Modifier</Button>
                      </>
                    )}
                  </SalaryCard>
                ) : (
                  <EstimateCard estimate={{ ...estimate.data, amount: preview ?? estimate.data.amount }}>
                    <form
                      className="flex w-full flex-col gap-2.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (hourly && (hours === '' || !(Number(hours) >= 0))) return toast('Nombre d’heures invalide.');
                        save.mutate();
                      }}
                    >
                      {hourly && <TextField label="Heures retenues" type="number" min={0} step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} />}
                      <TextField label="Note (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} />
                      <Button variant="primary" type="submit" disabled={save.isPending}>
                        Enregistrer le salaire
                      </Button>
                    </form>
                  </EstimateCard>
                )}
              </CardGrid>
            )}
          </QueryState>
        </Section>
      )}

      <Section title={employeeId ? 'Historique des salaires' : 'Salaires enregistrés'}>
        <QueryState isPending={list.isPending} error={list.error} refetch={list.refetch}>
          {rows.length ? (
            <CardGrid>
              {rows.map((s) => (
                <SalaryCard key={s.id} salary={s} showName={!employeeId}>
                  {!s.paid && (
                    <>
                      <Button variant="primary" onClick={() => pay.mutate(s.id)} disabled={pay.isPending}>
                        Marquer versé
                      </Button>
                      <Button onClick={() => setEditing(s)}>Modifier</Button>
                    </>
                  )}
                </SalaryCard>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun salaire enregistré.</EmptyState>
          )}
        </QueryState>
      </Section>
      <Note>
        Entraîneur à l’heure : heures des séances prévues moins les absences validées. Au mois : forfait réduit au prorata des
        séances manquées (règle provisoire, <b>à confirmer avec le bureau</b>). Un salaire versé n’est plus modifiable (R6).
      </Note>
      <EditSalaryModal salary={editing} onClose={() => setEditing(undefined)} />
    </>
  );
}
