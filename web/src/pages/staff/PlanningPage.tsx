import { useState } from 'react';
import { useMe } from '../../auth/AuthContext';
import { PlanningSection } from '../../components/PlanningSection';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { ProgramSessionModal } from '../../features/counter/ProgramSession';

/** Planning des terrains (personnel et administration) : séances par entraîneur et réservations, jour par jour. */
export function PlanningPage() {
  const me = useMe();
  const [program, setProgram] = useState(false);
  const canProgram = me.role === 'ADMIN' && me.permissions.includes('groups.manage');
  return (
    <>
      <PageHeader
        title="Planning des terrains"
        subtitle="Découvrez les séances et les réservations de chaque terrain, jour par jour."
        action={
          canProgram ? (
            <Button variant="primary" onClick={() => setProgram(true)}>
              + Séance ponctuelle
            </Button>
          ) : undefined
        }
      />
      {program && <ProgramSessionModal onClose={() => setProgram(false)} />}
      <div className="mt-5">
        <PlanningSection />
      </div>
    </>
  );
}
