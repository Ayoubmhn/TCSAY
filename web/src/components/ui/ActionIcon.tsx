import type { ComponentType } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../../lib/i18n';
import {
  IconArchive,
  IconArrow,
  IconBell,
  IconCheck,
  IconClipboard,
  IconMinus,
  IconSend,
  IconStar,
  IconWrench,
  IconX,
  IconCard,
  IconChart,
  IconEdit,
  IconEye,
  IconFile,
  IconPrinter,
  IconLink,
  IconPlus,
  IconPower,
  IconRestore,
  IconTrash,
} from './Icons';

export type ActionKind = 'view' | 'edit' | 'archive' | 'delete' | 'restore' | 'deactivate' | 'activate' | 'pay' | 'add' | 'link' | 'stats' | 'check' | 'refuse' | 'cancel' | 'remove' | 'remind' | 'send' | 'rate' | 'attendance' | 'maintenance' | 'open' | 'print' | 'pdf' | 'receipt';

const KINDS: Record<ActionKind, { Icon: ComponentType<{ size?: number }>; label: string; danger?: boolean }> = {
  view: { Icon: IconEye, label: 'Voir' },
  edit: { Icon: IconEdit, label: 'Modifier' },
  archive: { Icon: IconArchive, label: 'Archiver', danger: true },
  delete: { Icon: IconTrash, label: 'Supprimer', danger: true },
  restore: { Icon: IconRestore, label: 'Restaurer' },
  deactivate: { Icon: IconPower, label: 'Désactiver', danger: true },
  activate: { Icon: IconPower, label: 'Réactiver' },
  pay: { Icon: IconCard, label: 'Encaisser' },
  add: { Icon: IconPlus, label: 'Ajouter' },
  link: { Icon: IconLink, label: 'Lier' },
  stats: { Icon: IconChart, label: 'Statistiques' },
  check: { Icon: IconCheck, label: 'Valider' },
  refuse: { Icon: IconX, label: 'Refuser', danger: true },
  cancel: { Icon: IconX, label: 'Annuler', danger: true },
  remove: { Icon: IconMinus, label: 'Retirer', danger: true },
  remind: { Icon: IconBell, label: 'Envoyer un rappel' },
  send: { Icon: IconSend, label: 'Renvoyer' },
  rate: { Icon: IconStar, label: 'Évaluer' },
  attendance: { Icon: IconClipboard, label: 'Présences' },
  maintenance: { Icon: IconWrench, label: 'Entretien' },
  open: { Icon: IconArrow, label: 'Ouvrir' },
  print: { Icon: IconPrinter, label: 'Imprimer' },
  pdf: { Icon: IconFile, label: 'Reçu PDF' },
  receipt: { Icon: IconFile, label: 'Émettre le reçu' },
};

const CLS = 'act-ico grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full disabled:opacity-45';

/**
 * Bouton d'action en icône ronde (voir, modifier, archiver…) : info-bulle et libellé accessible obligatoires.
 * Actions destructives sur fond rose ; `to` en fait un lien.
 */
export function ActionIcon({
  kind,
  label,
  onClick,
  to,
  disabled,
  primary,
}: {
  kind: ActionKind;
  label?: string;
  onClick?: () => void;
  to?: string;
  disabled?: boolean;
  primary?: boolean;
}) {
  const { t } = useI18n();
  const { Icon, label: fallback, danger } = KINDS[kind];
  const text = t(label ?? fallback);
  const tone = primary ? 'bg-pri text-white' : danger ? 'bg-pr text-ink' : 'bg-btn text-fg';
  if (to) {
    return (
      <Link to={to} aria-label={text} title={text} className={`${CLS} ${tone}`}>
        <Icon size={18} />
      </Link>
    );
  }
  return (
    <button type="button" aria-label={text} title={text} onClick={onClick} disabled={disabled} className={`${CLS} ${tone}`}>
      <Icon size={18} />
    </button>
  );
}

/** Rangée d'icônes d'action (à droite en liste, en bas de carte en cases). */
export function ActionIcons({ children }: { children: React.ReactNode }) {
  return <div className="card-actions mt-auto flex flex-wrap items-center gap-1.5 pt-1">{children}</div>;
}
