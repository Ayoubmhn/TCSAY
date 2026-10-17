import { EmptyState } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill } from '../components/ui/Pill';

/** Module prévu dans une prochaine version (vSoon). */
export function SoonPage({ title, text }: { title: string; text: string }) {
  return (
    <>
      <PageHeader title={title} subtitle="Ce module est prévu dans une prochaine version." />
      <div className="mt-5">
        <EmptyState>
          <Pill tone="s">À venir</Pill>
          <p className="mb-0">{text}</p>
        </EmptyState>
      </div>
    </>
  );
}

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page introuvable" subtitle="Cette adresse ne correspond à aucun écran." />
      <div className="mt-5">
        <EmptyState>Utilisez le menu pour naviguer.</EmptyState>
      </div>
    </>
  );
}
