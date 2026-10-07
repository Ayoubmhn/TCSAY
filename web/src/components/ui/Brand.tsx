/** Logo officiel du club (fond transparent, web/public/logo-tcsay.png). */
export function Logo({ size = 44 }: { size?: number }) {
  return <img src="/logo-tcsay.png" alt="" width={size} height={size} className="flex-none object-contain" />;
}

/** Marque (.brand) : logo du club + nom. */
export function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-1.5">
      <Logo />
      <div>
        <b className="block font-semibold">TCSAY</b>
        <span className="text-xs text-mut">Tennis Club de Sayada</span>
      </div>
    </div>
  );
}
