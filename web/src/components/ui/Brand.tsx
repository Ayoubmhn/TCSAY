/** Marque (.brand) : balle verte « TC » + nom du club. */
export function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-1.5">
      <div aria-hidden="true" className="grid h-[38px] w-[38px] place-items-center rounded-full bg-pg text-[13px] font-semibold text-ink">
        TC
      </div>
      <div>
        <b className="block font-semibold">TCSAY</b>
        <span className="text-xs text-mut">Tennis Club de Sayada</span>
      </div>
    </div>
  );
}
