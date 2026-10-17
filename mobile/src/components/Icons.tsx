import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Icônes dessinées à la main (mêmes tracés que web/src/components/ui/Icons.tsx) : aucune bibliothèque d'icônes. */
type P = { size?: number; color: string };

function Base({ size = 22, color, children }: P & { children: ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

export const IconHome = (p: P) => (
  <Base {...p}>
    <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
  </Base>
);
export const IconCalendar = (p: P) => (
  <Base {...p}>
    <Rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <Path d="M3.5 10h17M8 3v4M16 3v4" />
    <Path d="m9 15 2 2 4-4" />
  </Base>
);
export const IconCard = (p: P) => (
  <Base {...p}>
    <Rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <Path d="M3 10h18M7 15h4" />
  </Base>
);
export const IconBell = (p: P) => (
  <Base {...p}>
    <Path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9z" />
    <Path d="M10 19a2 2 0 0 0 4 0" />
  </Base>
);
export const IconGrid = (p: P) => (
  <Base {...p}>
    <Rect x="4" y="4" width="7" height="7" rx="2" />
    <Rect x="13" y="4" width="7" height="7" rx="2" />
    <Rect x="4" y="13" width="7" height="7" rx="2" />
    <Rect x="13" y="13" width="7" height="7" rx="2" />
  </Base>
);
export const IconClipboard = (p: P) => (
  <Base {...p}>
    <Rect x="5" y="4" width="14" height="17" rx="2" />
    <Path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" />
  </Base>
);
export const IconWallet = (p: P) => (
  <Base {...p}>
    <Path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20H19a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2H5.5" />
    <Circle cx="16.5" cy="13.5" r="1.2" fill={p.color} stroke="none" />
  </Base>
);
export const IconChart = (p: P) => (
  <Base {...p}>
    <Path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Base>
);
export const IconSettings = (p: P) => (
  <Base {...p}>
    <Circle cx="12" cy="12" r="3" />
    <Path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
  </Base>
);
export const IconLogout = (p: P) => (
  <Base {...p}>
    <Path d="M10 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H10M15 8l-4 4 4 4M11 12h10" />
  </Base>
);
export const IconUserOff = (p: P) => (
  <Base {...p}>
    <Circle cx="10" cy="8" r="3.5" />
    <Path d="M3.5 20c.6-3.5 3.2-5.5 6.5-5.5 1.3 0 2.5.3 3.5.9M16 15l5 5M21 15l-5 5" />
  </Base>
);
export const IconChevronRight = (p: P) => (
  <Base {...p}>
    <Path d="m9 6 6 6-6 6" />
  </Base>
);
export const IconCheck = (p: P) => (
  <Base {...p}>
    <Path d="m5 12.5 4.5 4.5L19 7.5" />
  </Base>
);
export const IconRefresh = (p: P) => (
  <Base {...p}>
    <Path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
  </Base>
);
export const IconSwap = (p: P) => (
  <Base {...p}>
    <Path d="M7 7h12l-3-3M17 17H5l3 3" />
  </Base>
);
