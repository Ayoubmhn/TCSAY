import { createContext, useContext } from 'react';

/** Jetons du design system (docs/tcsay-prototype-v4.html), clair et sombre. */
export type Tokens = {
  bg: string;
  fg: string;
  mut: string;
  card: string;
  line: string;
  fld: string;
  btn: string;
  pri: string;
  sel: string;
  dr: string;
  day: string;
  paid: string;
  topay: string;
  ink: string;
  overlay: string;
};

export const LIGHT: Tokens = {
  bg: '#fafafa',
  fg: '#1a1a1a',
  mut: '#8a8a8f',
  card: '#ffffff',
  line: '#e6e6ea',
  fld: '#f3f4f8',
  btn: '#ebebeb',
  pri: '#5a5acd',
  sel: '#0000e0',
  dr: '#f7f8fb',
  day: '#f1f2f6',
  paid: '#e9f7e1',
  topay: '#ffe8e8',
  ink: '#111111',
  overlay: 'rgba(0,0,0,0.45)',
};

export const DARK: Tokens = {
  bg: '#121212',
  fg: '#f2f2f2',
  mut: '#9a9aa0',
  card: '#1c1c1e',
  line: '#333333',
  fld: '#26272b',
  btn: '#2e2e32',
  pri: '#5a5acd',
  sel: '#0000e0',
  dr: '#17181b',
  day: '#2a2b30',
  paid: '#1f2e1a',
  topay: '#3a2224',
  ink: '#111111',
  overlay: 'rgba(0,0,0,0.6)',
};

/** Pastilles : texte toujours #111. b = info / date, g = libre / payé, r = pris / à payer, s = neutre. */
export const PILL = { b: '#c9e9fb', g: '#dff3a8', r: '#fdb3b0', s: '#f0d9a8' } as const;
export type PillTone = keyof typeof PILL;

/** Une seule police : Montserrat 400 / 500 / 600. */
export const FONT = {
  regular: 'Montserrat_400Regular',
  medium: 'Montserrat_500Medium',
  semibold: 'Montserrat_600SemiBold',
} as const;

export type ThemeMode = 'system' | 'light' | 'dark';

export const ThemeContext = createContext<{ t: Tokens; dark: boolean; mode: ThemeMode; setMode: (m: ThemeMode) => void }>({
  t: LIGHT,
  dark: false,
  mode: 'system',
  setMode: () => undefined,
});

export const useTheme = () => useContext(ThemeContext);
