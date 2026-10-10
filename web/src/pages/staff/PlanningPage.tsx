import { PlanningSection } from '../../components/PlanningSection';
import { PageHeader } from '../../components/ui/PageHeader';

/** Planning des terrains (personnel et administration) : séances par entraîneur et réservations, jour par jour. */
export function PlanningPage() {
  return (
    <>
      <PageHeader title="Planning des terrains" subtitle="Découvrez les séances et les réservations de chaque terrain, jour par jour." />
      <div className="mt-5">
        <PlanningSection />
      </div>
    </>
  );
}
