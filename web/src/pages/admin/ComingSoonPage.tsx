import { useLocation } from 'react-router';
import { EmptyState } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill } from '../../components/ui/Pill';
import { ADMIN_MENU } from '../../layouts/adminMenu';

const IMPORT_TEXT =
  'Numérisation des cahiers depuis 2010 : envoi des scans, extraction par IA, validation humaine ligne par ligne (sprint 9, pilote de 30 à 50 pages).';

/** Module non livré (vSoon du prototype). */
export function ComingSoonPage() {
  const { pathname } = useLocation();
  const entry = ADMIN_MENU.find((e) => e.path === pathname);

  if (!entry) {
    return (
      <>
        <PageHeader title="Page introuvable" subtitle="Cette adresse ne correspond à aucun écran." />
        <div className="mt-5">
          <EmptyState>Utilisez le menu pour naviguer.</EmptyState>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={entry.label} subtitle="Ce module est prévu dans une prochaine version." />
      <div className="mt-5">
        <EmptyState>
          <Pill tone="s">À venir</Pill>
          <p className="mb-0">{entry.path === '/admin/import' ? IMPORT_TEXT : 'Ce module est en cours de développement.'}</p>
        </EmptyState>
      </div>
    </>
  );
}
