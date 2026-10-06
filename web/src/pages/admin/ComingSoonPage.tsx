import { useLocation } from 'react-router';
import { Card, CardTitle } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill } from '../../components/ui/Pill';
import { ADMIN_MENU } from '../../layouts/adminMenu';

export function ComingSoonPage() {
  const { pathname } = useLocation();
  const entry = ADMIN_MENU.find((e) => e.path === pathname);

  return (
    <>
      <PageHeader title={entry?.label ?? 'Page introuvable'} />
      <Card className="flex flex-col items-start gap-3">
        <Pill tone="sand">À venir</Pill>
        <CardTitle>{entry ? 'Ce module est en cours de développement.' : 'Cette page n’existe pas.'}</CardTitle>
      </Card>
    </>
  );
}
