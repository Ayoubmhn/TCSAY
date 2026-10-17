/** Logo officiel du club (fond transparent, web/public/logo-tcsay.png). */
export function Logo({ size = 44 }: { size?: number }) {
  return <img src="/logo-tcsay.png" alt="" width={size} height={size} className="flex-none object-contain [image-rendering:auto]" />;
}

/** Marque (.brand) : logo du club + nom. */
export function Brand() {
  return (
    <div className="flex items-center gap-3 px-1">
      <Logo size={58} />
      <div>
        <b className="block font-semibold">TCSAY</b>
        <span className="text-xs text-mut">Tennis Club de Sayada</span>
      </div>
    </div>
  );
}
