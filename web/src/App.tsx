import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { homeOf, useAuth } from './auth/AuthContext';
import { EmptyState } from './components/ui/Card';
import { SeasonDetailPage } from './features/seasons/SeasonDetailPage';
import { SeasonsPage } from './features/seasons/SeasonsPage';
import { AppShell } from './layouts/AppShell';
import type { Role } from './lib/types';
import { AuditPage } from './pages/admin/AuditPage';
import { CategoriesPage } from './pages/admin/CategoriesPage';
import { CoachesPage } from './pages/admin/CoachesPage';
import { CourtRatesPage } from './pages/admin/CourtRatesPage';
import { CourtsPage } from './pages/admin/CourtsPage';
import { DashboardPage } from './pages/admin/DashboardPage';
import { EmailsPage } from './pages/admin/EmailsPage';
import { FeesPage } from './pages/admin/FeesPage';
import { GroupsPage } from './pages/admin/GroupsPage';
import { ParentsPage } from './pages/admin/ParentsPage';
import { PaymentsAdminPage } from './pages/admin/PaymentsAdminPage';
import { PermissionsPage } from './pages/admin/PermissionsPage';
import { PlayersPage } from './pages/admin/PlayersPage';
import { CoachProfilePage, ParentProfilePage, PlayerProfilePage, StaffProfilePage } from './pages/admin/ProfilePages';
import { RegistrationFormPage } from './pages/admin/RegistrationFormPage';
import { ReservationsAdminPage } from './pages/admin/ReservationsAdminPage';
import { SalariesPage } from './pages/admin/SalariesPage';
import { StaffPage } from './pages/admin/StaffPage';
import { ChangePasswordPage } from './pages/auth/ChangePasswordPage';
import { LoginPage } from './pages/auth/LoginPage';
import { BookPage } from './pages/BookPage';
import { CoachAbsencesPage } from './pages/coach/CoachAbsencesPage';
import { CoachAttendancePage } from './pages/coach/CoachAttendancePage';
import { CoachSalariesPage } from './pages/coach/CoachSalariesPage';
import { CoachSessionsPage } from './pages/coach/CoachSessionsPage';
import { AbsencesPage } from './pages/player/AbsencesPage';
import { HomePage } from './pages/player/HomePage';
import { PaymentsPage } from './pages/player/PaymentsPage';
import { SessionsPage } from './pages/player/SessionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage, SoonPage } from './pages/SoonPage';
import { PlanningPage } from './pages/staff/PlanningPage';

/**
 * Connexion obligatoire, mot de passe temporaire changé, espace (rôle d'action) autorisé,
 * et dans l'espace administration au moins une des autorisations demandées.
 */
function Protected({ roles, perm, children }: { roles?: Role[]; perm?: string[]; children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
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
    <Routes>
      <Route path="/connexion" element={<LoginPage />} />
      <Route path="/mot-de-passe" element={<ChangePasswordPage />} />

      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        {/* Tous les rôles */}
        <Route path="parametres" element={<SettingsPage />} />

        {/* Joueur / parent */}
        <Route index element={<Protected roles={PLAYER}><HomePage /></Protected>} />
        <Route path="paiements" element={<Protected roles={PLAYER}><PaymentsPage /></Protected>} />
        <Route path="seances" element={<Protected roles={PLAYER}><SessionsPage /></Protected>} />
        <Route path="absences" element={<Protected roles={PLAYER}><AbsencesPage /></Protected>} />
        <Route path="reserver" element={<Protected roles={PLAYER}><BookPage /></Protected>} />
        <Route
          path="tournois"
          element={
            <Protected roles={PLAYER}>
              <SoonPage title="Historique des tournois" text="Vos résultats et participations aux tournois apparaîtront ici." />
            </Protected>
          }
        />

        {/* Entraîneur */}
        <Route path="coach/seances" element={<Protected roles={['COACH']}><CoachSessionsPage /></Protected>} />
        <Route path="coach/presences" element={<Protected roles={['COACH']}><CoachAttendancePage /></Protected>} />
        <Route path="coach/salaires" element={<Protected roles={['COACH']}><CoachSalariesPage /></Protected>} />
        <Route path="coach/absences" element={<Protected roles={['COACH']}><CoachAbsencesPage /></Protected>} />
        <Route path="coach/reserver" element={<Protected roles={['COACH']}><BookPage /></Protected>} />

        {/* Administration : président, agents, superviseur, directeur technique (selon les autorisations) */}
        <Route path="admin" element={admin(['stats.view'], <DashboardPage />)} />
        <Route path="admin/planning" element={admin(['planning.view', 'groups.manage'], <PlanningPage />)} />
        <Route path="admin/joueurs" element={admin(['players.manage'], <PlayersPage />)} />
        <Route path="admin/joueurs/:id" element={admin(['players.manage', 'payments.collect', 'groups.manage', 'parents.manage'], <PlayerProfilePage />)} />
        <Route path="admin/parents" element={admin(['parents.manage'], <ParentsPage />)} />
        <Route path="admin/parents/:id" element={admin(['parents.manage', 'players.manage', 'payments.collect'], <ParentProfilePage />)} />
        <Route path="admin/entraineurs" element={admin(['coaches.manage'], <CoachesPage />)} />
        <Route path="admin/entraineurs/:id" element={admin(['coaches.manage', 'salaries.manage', 'groups.manage', 'absences.manage'], <CoachProfilePage />)} />
        <Route path="admin/personnel" element={admin(['staff.manage'], <StaffPage />)} />
        <Route path="admin/personnel/:id" element={admin(['staff.manage'], <StaffProfilePage />)} />
        <Route path="admin/fiche-inscription" element={admin(['players.manage'], <RegistrationFormPage />)} />
        <Route path="admin/groupes" element={admin(['groups.manage'], <GroupsPage />)} />
        <Route path="admin/absences" element={admin(['absences.manage'], <CoachAbsencesPage admin />)} />
        <Route path="admin/categories" element={admin(['seasons.manage'], <CategoriesPage />)} />
        <Route path="admin/saisons" element={admin(['seasons.manage', 'stats.view'], <SeasonsPage />)} />
        <Route path="admin/saisons/:id" element={admin(['seasons.manage', 'stats.view'], <SeasonDetailPage />)} />
        <Route path="admin/terrains" element={admin(['courts.manage'], <CourtsPage />)} />
        <Route path="admin/reservations" element={admin(['reservations.manage'], <ReservationsAdminPage />)} />
        <Route path="admin/tarifs-terrains" element={admin(['courts.manage'], <CourtRatesPage />)} />
        <Route path="admin/paiements" element={admin(['payments.collect'], <PaymentsAdminPage />)} />
        <Route path="admin/tarifs" element={admin(['fees.manage'], <FeesPage />)} />
        <Route path="admin/salaires" element={admin(['salaries.manage'], <SalariesPage />)} />
        <Route path="admin/mes-salaires" element={admin(undefined, <CoachSalariesPage />)} />
        <Route path="admin/emails" element={admin(['emails.view'], <EmailsPage />)} />
        <Route path="admin/audit" element={admin(['audit.view'], <AuditPage />)} />
        <Route path="admin/autorisations" element={admin(['permissions.manage'], <PermissionsPage />)} />
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
  );
}
