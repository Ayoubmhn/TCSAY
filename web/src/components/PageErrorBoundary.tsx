import { Component, type ErrorInfo, type ReactNode } from 'react';
import { OfflinePageError } from '../lib/lazy-page';

type Props = { children: ReactNode; resetKey?: string; full?: boolean };
type State = { error: Error | null };

/**
 * Écran de secours : une page qui ne s'ouvre pas (pas de réseau, erreur) n'affiche plus un écran noir,
 * mais un message avec « Réessayer », « Retour » et « Accueil ». Remis à zéro au changement de page.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page en erreur', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const offline = error instanceof OfflinePageError || !navigator.onLine;
    const btn = 'inline-flex items-center justify-center rounded-full px-5 py-[11px] font-semibold';
    return (
      <div className={`flex flex-col items-center justify-center gap-4 px-4 text-center ${this.props.full ? 'min-h-dvh bg-bg text-fg' : 'py-16'}`}>
        <span className="text-[40px]" aria-hidden="true">
          {offline ? '📶' : '⚠️'}
        </span>
        <h1 className="m-0 text-[23px] font-semibold">{offline ? 'Pas de connexion' : 'Cette page ne s’est pas ouverte'}</h1>
        <p className="m-0 max-w-[420px] text-[15px] text-mut">
          {offline
            ? 'Cette page n’est pas encore enregistrée sur votre téléphone. Revenez en arrière ou réessayez dès que le réseau revient.'
            : 'Une erreur est survenue. Réessayez, ou revenez à la page précédente.'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className={`${btn} bg-pri text-white`} onClick={() => (navigator.onLine ? window.location.reload() : this.setState({ error: null }))}>
            Réessayer
          </button>
          <button type="button" className={`${btn} bg-btn text-fg`} onClick={() => (this.setState({ error: null }), window.history.back())}>
            ‹ Retour
          </button>
          <button type="button" className={`${btn} bg-btn text-fg`} onClick={() => (this.setState({ error: null }), window.history.pushState({}, '', '/'), window.dispatchEvent(new PopStateEvent('popstate')))}>
            Accueil
          </button>
        </div>
      </div>
    );
  }
}
