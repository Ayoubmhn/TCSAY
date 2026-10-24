import { IS_DEMO } from '../../lib/variant';

/**
 * Logo officiel du club (fond transparent, web/public/logo-tcsay.png). Version démo : bandeau orange « DÉMO » en bas,
 * comme l'icône de l'application, pour ne jamais confondre la démo et la version du club.
 */
export function Logo({ size = 44 }: { size?: number }) {
  const img = <img src="/logo-tcsay.png" alt="" width={size} height={size} className="flex-none object-contain [image-rendering:auto]" />;
  if (!IS_DEMO) return img;
  return (
    <span className="relative inline-flex flex-none" style={{ width: size, height: size }}>
      {img}
      <span
        aria-hidden="true"
        className="absolute inset-x-[4%] bottom-[2%] rounded-full border-2 border-white bg-[#c2410c] text-center font-semibold leading-none text-white"
        style={{ fontSize: Math.max(7, Math.round(size * 0.17)), paddingBlock: Math.max(1, Math.round(size * 0.035)) }}
      >
        DÉMO
      </span>
    </span>
  );
}

/** Marque (.brand) : logo du club + nom (et pastille « Démo » sur la démo). */
export function Brand() {
  return (
    <div className="flex items-center gap-3 px-1">
      <Logo size={58} />
      <div>
        <b className="block font-semibold">
          TCSAY
          {IS_DEMO && <span className="ms-2 rounded-full bg-[#f0d9a8] px-2 py-0.5 align-middle text-[11px] font-semibold text-[#111]">Démo</span>}
        </b>
        <span className="text-xs text-mut">Tennis Club de Sayada</span>
      </div>
    </div>
  );
}
