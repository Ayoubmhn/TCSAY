/** Bouton menu : carré 46px, rayon 14px, 4 points en grille 2×2. */
export function MenuButton({ onClick, expanded }: { onClick: () => void; expanded: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={expanded ? 'Fermer le menu' : 'Ouvrir le menu'}
      aria-expanded={expanded}
      className="grid h-[46px] w-[46px] grid-cols-2 place-content-center gap-1.5 rounded-[14px] border-[1.5px] border-line bg-card"
    >
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="h-[6px] w-[6px] rounded-full bg-fg" />
      ))}
    </button>
  );
}
