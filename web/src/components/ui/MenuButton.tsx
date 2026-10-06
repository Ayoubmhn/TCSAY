/** Bouton menu (.mbtn) : carré 46px, rayon 15px, fond --btn, 4 points 7px en grille 2×2. Visible sous 860px. */
export function MenuButton({ onClick, expanded }: { onClick: () => void; expanded: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={expanded ? 'Fermer le menu' : 'Ouvrir le menu'}
      aria-expanded={expanded}
      className="grid h-[46px] w-[46px] grid-cols-[repeat(2,7px)] place-content-center gap-[5px] rounded-[15px] bg-btn nav:hidden"
    >
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className="h-[7px] w-[7px] rounded-full bg-fg" />
      ))}
    </button>
  );
}
