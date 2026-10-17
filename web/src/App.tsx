import { Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { homeOf, useAuth } from './auth/AuthContext';
import { Button } from './components/ui/Button';
import { useI18n } from './lib/i18n';
import { EmptyState } from './components/ui/Card';
import { AppShell } from './layouts/AppShell';
import type { Role } from './lib/types';
import { LoginPage } from './pages/auth/LoginPage';
import { PaymentGate } from './components/PaymentGate';
import { PermissionsGate } from './components/PermissionsGate';
import { page } from './lib/lazy-page';

// Chaque écran est chargé à sa première ouverture (fichiers séparés) : premier affichage plus rapide, surtout sur téléphone.
const SeasonDetailPage = page(() => import('./features/seasons/SeasonDetailPage'), 'SeasonDetailPage');
const FinanceStatsPage = page(() => import('./features/stats/FinanceStatsPage'), 'FinanceStatsPage');
const SeasonsPage = page(() => import('./features/seasons/SeasonsPage'), 'SeasonsPage');
const AuditPage = page(() => import('./pages/admin/AuditPage'), 'AuditPage');
const BroadcastsPage = page(() => import('./pages/admin/BroadcastsPage'), 'BroadcastsPage');
const CategoriesPage = page(() => import('./pages/admin/CategoriesPage'), 'CategoriesPage');
const CoachesPage = page(() => import('./pages/admin/CoachesPage'), 'CoachesPage');
const CourtRatesPage = page(() => import('./pages/admin/CourtRatesPage'), 'CourtRatesPage');
const CourtsPage = page(() => import('./pages/admin/CourtsPage'), 'CourtsPage');
const DashboardPage = page(() => import('./pages/admin/DashboardPage'), 'DashboardPage');
const EmailsPage = page(() => import('./pages/admin/EmailsPage'), 'EmailsPage');
const FeesPage = page(() => import('./pages/admin/FeesPage'), 'FeesPage');
const GroupDetailPage = page(() => import('./pages/admin/GroupDetailPage'), 'GroupDetailPage');
const GroupsPage = page(() => import('./pages/admin/GroupsPage'), 'GroupsPage');
const ParentsPage = page(() => import('./pages/admin/ParentsPage'), 'ParentsPage');
const PaymentsAdminPage = page(() => import('./pages/admin/PaymentsAdminPage'), 'PaymentsAdminPage');
const PermissionsPage = page(() => import('./pages/admin/PermissionsPage'), 'PermissionsPage');
const PlayersImportPage = page(() => import('./pages/admin/PlayersImportPage'), 'PlayersImportPage');
const PlayersPage = page(() => import('./pages/admin/PlayersPage'), 'PlayersPage');
const CoachProfilePage = page(() => import('./pages/admin/ProfilePages'), 'CoachProfilePage');
const ParentProfilePage = page(() => import('./pages/admin/ProfilePages'), 'ParentProfilePage');
const PlayerProfilePage = page(() => import('./pages/admin/ProfilePages'), 'PlayerProfilePage');
const StaffProfilePage = page(() => import('./pages/admin/ProfilePages'), 'StaffProfilePage');
const RegistrationFormPage = page(() => import('./pages/admin/RegistrationFormPage'), 'RegistrationFormPage');
const ReservationsAdminPage = page(() => import('./pages/admin/ReservationsAdminPage'), 'ReservationsAdminPage');
const SalariesPage = page(() => import('./pages/admin/SalariesPage'), 'SalariesPage');
const StaffPage = page(() => import('./pages/admin/StaffPage'), 'StaffPage');
const UpdatesPage = page(() => import('./pages/admin/UpdatesPage'), 'UpdatesPage');
const ChangePasswordPage = page(() => import('./pages/auth/ChangePasswordPage'), 'ChangePasswordPage');
const InvitationPage = page(() => import('./pages/auth/InvitationPage'), 'InvitationPage');
const BookPage = page(() => import('./pages/BookPage'), 'BookPage');
const CoachAbsencesPage = page(() => import('./pages/coach/CoachAbsencesPage'), 'CoachAbsencesPage');
const EvaluationsPage = page(() => import('./pages/coach/EvaluationsPage'), 'EvaluationsPage');
const TechOverviewPage = page(() => import('./pages/admin/TechOverviewPage'), 'TechOverviewPage');
const ExercisesCoachPage = page(() => import('./features/exercises/ExercisesCoachPage'), 'ExercisesCoachPage');
const ExercisesPage = page(() => import('./features/exercises/ExercisesPage'), 'ExercisesPage');
const MatchesPage = page(() => import('./features/matches/MatchesPage'), 'MatchesPage');
const MatchPage = page(() => import('./features/matches/MatchPage'), 'MatchPage');
const PaymentAccessPage = page(() => import('./pages/admin/PaymentAccessPage'), 'PaymentAccessPage');
const CoachAttendancePage = page(() => import('./pages/coach/CoachAttendancePage'), 'CoachAttendancePage');
const CoachSalariesPage = page(() => import('./pages/coach/CoachSalariesPage'), 'CoachSalariesPage');
const CoachSessionsPage = page(() => import('./pages/coach/CoachSessionsPage'), 'CoachSessionsPage');
const ProgressPage = page(() => import('./pages/player/ProgressPage'), 'ProgressPage');
const AbsencesPage = page(() => import('./pages/player/AbsencesPage'), 'AbsencesPage');
const HomePage = page(() => import('./pages/player/HomePage'), 'HomePage');
const PaymentsPage = page(() => import('./pages/player/PaymentsPage'), 'PaymentsPage');
const SessionsPage = page(() => import('./pages/player/SessionsPage'), 'SessionsPage');
const NotificationsPage = page(() => import('./pages/NotificationsPage'), 'NotificationsPage');
const SettingsPage = page(() => import('./pages/SettingsPage'), 'SettingsPage');
const TournamentsPage = page(() => import('./features/tournaments/TournamentsPage'), 'TournamentsPage');
const AlbumsPage = page(() => import('./features/albums/AlbumsPage'), 'AlbumsPage');
const AlbumPage = page(() => import('./features/albums/AlbumPage'), 'AlbumPage');
const ComplaintsPage = page(() => import('./features/complaints/ComplaintsPage'), 'ComplaintsPage');
const ComplaintPage = page(() => import('./features/complaints/ComplaintPage'), 'ComplaintPage');
const ComplaintsAdminPage = page(() => import('./features/complaints/ComplaintsAdminPage'), 'ComplaintsAdminPage');
const TournamentPage = page(() => import('./features/tournaments/TournamentPage'), 'TournamentPage');
const FederationAccountsPage = page(() => import('./pages/admin/FederationAccountsPage'), 'FederationAccountsPage');
const ReenrollmentPage = page(() => import('./pages/admin/ReenrollmentPage'), 'ReenrollmentPage');
const ExpensesPage = page(() => import('./pages/admin/ExpensesPage'), 'ExpensesPage');
const AvailabilityAdminPage = page(() => import('./pages/admin/AvailabilityAdminPage'), 'AvailabilityAdminPage');
const AvailabilityPage = page(() => import('./pages/AvailabilityPage'), 'AvailabilityPage');
const NotFoundPage = page(() => import('./pages/SoonPage'), 'NotFoundPage');
const SoonPage = page(() => import('./pages/SoonPage'), 'SoonPage');
const PlanningPage = page(() => import('./pages/staff/PlanningPage'), 'PlanningPage');
const ReceiptsPage = page(() => import('./pages/admin/ReceiptsPage'), 'ReceiptsPage');
const ReceiptPrintPage = page(() => import('./features/receipts/ReceiptPrintPage'), 'ReceiptPrintPage');

/**
 * Connexion obligatoire, mot de passe temporaire changé, espace (rôle d'action) autorisé,
 * et dans l'espace administration au moins une des autorisations demandées.
 */
function Protected({ roles, perm, children }: { roles?: Role[]; perm?: string[]; children: ReactNode }) {
  const { me, loading, offline, retry } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  if (offline) {
    return (
      <div className="grid min-h-full place-items-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <h1 className="text-[23px] font-semibold">{t('Pas de connexion')}</h1>
          <p className="text-mut">{t('Vérifiez le réseau (Wi-Fi ou données mobiles) : votre session est gardée.')}</p>
          <Button variant="primary" onClick={retry}>
            Réessayer
          </Button>
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="grid min-h-full place-items-center p-6">
        <EmptyState>Chargement…</EmptyState>
      </div>
    );
  }
  if (!me) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (me.mustChangePassword) return <Navigate to="/mot-de-passe" replace />;
  const home = homeOf(me);
  if (roles && !roles.includes(me.role)) return <Navigate to={home} replace />;
  if (perm && !perm.some((p) => me.permissions.includes(p))) {
    return location.pathname === home ? <Navigate to="/parametres" replace /> : <Navigate to={home} replace />;
  }
  return <>{children}</>;
}

/** Pendant le chargement d'un écran. */
function Loading() {
  return (
    <div className="grid min-h-[50vh] place-items-center p-6">
      <EmptyState>Chargement…</EmptyState>
    </div>
  );
}

const PLAYER: Role[] = ['PLAYER', 'PARENT'];
const ADMIN: Role[] = ['ADMIN'];

/** Page de l'espace administration réservée à certaines autorisations. */
const admin = (perm: string[] | undefined, page: ReactNode) => (
  <Protected roles={ADMIN} perm={perm}>
    {page}
  </Protected>
);

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
      <Route path="/connexion" element={<LoginPage />} />
      <Route path="/mot-de-passe" element={<ChangePasswordPage />} />
      <Route path="/bienvenue/:token" element={<InvitationPage />} />
      {/* Impression des reçus : onglet séparé, sans menu */}
      <Route path="/impression/recu/:id" element={admin(['payments.collect'], <ReceiptPrintPage />)} />
      <Route path="/impression/recu-test" element={admin(['payments.collect'], <ReceiptPrintPage test />)} />

      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        {/* Tous les rôles */}
        <Route path="parametres" element={<SettingsPage />} />
        <Route path="parametres/autorisations" element={admin(['permissions.manage'], <PermissionsGate><PermissionsPage /></PermissionsGate>)} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="matchs" element={<MatchesPage />} />
        <Route path="matchs/:id" element={<MatchPage />} />

        {/* Joueur / parent */}
        <Route index element={<Protected roles={PLAYER}><HomePage /></Protected>} />
        <Route path="paiements" element={<Protected roles={PLAYER}><PaymentsPage /></Protected>} />
        <Route path="seances" element={<Protected roles={PLAYER}><PaymentGate module="sessions" title="Mes séances"><SessionsPage /></PaymentGate></Protected>} />
        <Route path="absences" element={<Protected roles={PLAYER}><PaymentGate module="sessions" title="Mes absences"><AbsencesPage /></PaymentGate></Protected>} />
        <Route path="suivi" element={<Protected roles={PLAYER}><PaymentGate module="progress" title="Suivi et progression"><ProgressPage /></PaymentGate></Protected>} />
        <Route path="exercices" element={<Protected roles={PLAYER}><PaymentGate module="exercises" title="Exercices"><ExercisesPage /></PaymentGate></Protected>} />
        <Route path="reserver" element={<Protected roles={PLAYER}><PaymentGate module="reservation" title="Réserver un terrain"><BookPage /></PaymentGate></Protected>} />
        <Route path="tournois" element={<TournamentsPage />} />
        <Route path="photos" element={<AlbumsPage />} />
        <Route path="photos/:id" element={<AlbumPage />} />
        <Route path="reclamations" element={<ComplaintsPage />} />
        <Route path="reclamations/:id" element={<ComplaintPage />} />
        <Route path="admin/reclamations" element={admin(['complaints.manage', 'payments.collect', 'reservations.manage', 'evaluations.manage', 'groups.manage', 'courts.manage'], <ComplaintsAdminPage />)} />
        <Route path="admin/reclamations/:id" element={admin(['complaints.manage', 'payments.collect', 'reservations.manage', 'evaluations.manage', 'groups.manage', 'courts.manage'], <ComplaintPage admin />)} />
        <Route path="tournois/:id" element={<TournamentPage />} />

        {/* Entraîneur */}
        <Route path="coach/seances" element={<Protected roles={['COACH']}><CoachSessionsPage /></Protected>} />
        <Route path="coach/presences" element={<Protected roles={['COACH']}><CoachAttendancePage /></Protected>} />
        <Route path="coach/salaires" element={<Protected roles={['COACH']}><CoachSalariesPage /></Protected>} />
        <Route path="coach/absences" element={<Protected roles={['COACH']}><CoachAbsencesPage /></Protected>} />
        <Route path="coach/disponibilites" element={<Protected roles={['COACH']}><AvailabilityPage /></Protected>} />
        <Route path="disponibilites" element={<Protected roles={PLAYER}><AvailabilityPage /></Protected>} />
        <Route path="coach/bilans" element={<Protected roles={['COACH']}><EvaluationsPage /></Protected>} />
        <Route path="coach/exercices" element={<Protected roles={['COACH']}><ExercisesCoachPage /></Protected>} />
        <Route path="coach/reserver" element={<Protected roles={['COACH']}><BookPage /></Protected>} />

        {/* Administration : président, agents, superviseur, directeur technique (selon les autorisations) */}
        <Route path="admin" element={admin(['stats.view'], <DashboardPage />)} />
        <Route path="admin/statistiques" element={admin(['stats.view'], <FinanceStatsPage />)} />
        <Route path="admin/planning" element={admin(['planning.view', 'groups.manage'], <PlanningPage />)} />
        <Route path="admin/joueurs" element={admin(['players.manage'], <PlayersPage />)} />
        <Route path="admin/joueurs/import" element={admin(['players.manage'], <PlayersImportPage />)} />
        <Route path="admin/joueurs/:id" element={admin(['players.manage', 'payments.collect', 'groups.manage', 'parents.manage'], <PlayerProfilePage />)} />
        <Route path="admin/parents" element={admin(['parents.manage'], <ParentsPage />)} />
        <Route path="admin/parents/:id" element={admin(['parents.manage', 'players.manage', 'payments.collect'], <ParentProfilePage />)} />
        <Route path="admin/entraineurs" element={admin(['coaches.manage'], <CoachesPage />)} />
        <Route path="admin/entraineurs/:id" element={admin(['coaches.manage', 'salaries.manage', 'groups.manage', 'absences.manage'], <CoachProfilePage />)} />
        <Route path="admin/personnel" element={admin(['staff.manage'], <StaffPage />)} />
        <Route path="admin/ijin" element={admin(['federation.manage'], <FederationAccountsPage />)} />
        <Route path="admin/reinscriptions" element={admin(['players.manage'], <ReenrollmentPage />)} />
        <Route path="admin/depenses" element={admin(['expenses.manage'], <ExpensesPage />)} />
        <Route path="admin/disponibilites" element={admin(['groups.manage'], <AvailabilityAdminPage />)} />
        <Route path="admin/personnel/:id" element={admin(['staff.manage'], <StaffProfilePage />)} />
        <Route path="admin/fiche-inscription" element={admin(['players.manage'], <RegistrationFormPage />)} />
        <Route path="admin/groupes" element={admin(['groups.manage'], <GroupsPage />)} />
        <Route path="admin/groupes/:id" element={admin(['groups.manage', 'planning.view', 'players.manage'], <GroupDetailPage />)} />
        <Route path="admin/absences" element={admin(['absences.manage'], <CoachAbsencesPage admin />)} />
        <Route path="admin/bilans" element={admin(['evaluations.manage'], <EvaluationsPage admin />)} />
        <Route path="admin/suivi-technique" element={admin(['evaluations.manage'], <TechOverviewPage />)} />
        <Route path="admin/exercices" element={admin(['evaluations.manage'], <ExercisesCoachPage />)} />
        <Route path="admin/categories" element={admin(['seasons.manage'], <CategoriesPage />)} />
        <Route path="admin/saisons" element={admin(['seasons.manage', 'stats.view'], <SeasonsPage />)} />
        <Route path="admin/saisons/:id" element={admin(['seasons.manage', 'stats.view'], <SeasonDetailPage />)} />
        <Route path="admin/terrains" element={admin(['courts.manage'], <CourtsPage />)} />
        <Route path="admin/reservations" element={admin(['reservations.manage'], <ReservationsAdminPage />)} />
        <Route path="admin/tarifs-terrains" element={admin(['courts.manage'], <CourtRatesPage />)} />
        <Route path="admin/paiements" element={admin(['payments.collect'], <PaymentsAdminPage />)} />
        <Route path="admin/recus" element={admin(['payments.collect'], <ReceiptsPage />)} />
        <Route path="admin/acces-paiement" element={admin(['permissions.manage', 'payments.collect'], <PaymentAccessPage />)} />
        <Route path="admin/tarifs" element={admin(['fees.manage'], <FeesPage />)} />
        <Route path="admin/salaires" element={admin(['salaries.manage'], <SalariesPage />)} />
        <Route path="admin/mes-salaires" element={admin(undefined, <CoachSalariesPage />)} />
        <Route path="admin/mises-a-jour" element={admin(['groups.manage', 'payments.collect'], <UpdatesPage />)} />
        <Route path="admin/notifications" element={admin(['notifications.send'], <BroadcastsPage />)} />
        <Route path="admin/emails" element={admin(['emails.view'], <EmailsPage />)} />
        <Route path="admin/audit" element={admin(['audit.view'], <AuditPage />)} />
        <Route path="admin/autorisations" element={<Navigate to="/parametres/autorisations" replace />} />
        <Route
          path="admin/import"
          element={admin(
            ['import.manage'],
            <SoonPage
              title="Import historique"
              text="Numérisation des cahiers depuis 2010 : envoi des scans, extraction par IA, validation humaine ligne par ligne (sprint 9, pilote de 30 à 50 pages)."
            />,
          )}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      </Routes>
    </Suspense>
  );
}
