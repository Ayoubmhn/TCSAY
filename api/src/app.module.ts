import { UpdatesController } from './imports/updates.controller';
import { UpdatesService } from './imports/updates.service';
import { LoginThrottle } from './security/login-throttle';
import { PermissionsCodeGuard, PermissionsCodeService } from './permissions/permissions-code';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CoachAbsencesController } from './absences/coach-absences.controller';
import { AttendanceController } from './attendance/attendance.controller';
import { SessionReviewController } from './attendance/session-review.controller';
import { ProgressController } from './attendance/progress.controller';
import { EvaluationsController } from './evaluations/evaluations.controller';
import { ExercisesController } from './exercises/exercises.controller';
import { PaymentAccessController } from './access/payment-access.controller';
import { MatchesController } from './matches/matches.controller';
import { AuditController } from './audit/audit.controller';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { CategoriesController } from './categories/categories.controller';
import { CoachesController } from './coaches/coaches.controller';
import { CoreModule } from './core.module';
import { CourtRatesController } from './court-rates/court-rates.controller';
import { CourtsController } from './courts/courts.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { PlanningController } from './dashboard/planning.controller';
import { FinanceStatsController } from './dashboard/finance-stats.controller';
import { SeasonStatsController } from './dashboard/season-stats.controller';
import { EventsController } from './events/events.controller';
import { FeesController } from './fees/fees.controller';
import { GroupsController } from './groups/groups.controller';
import { HealthController } from './health.controller';
import { EmailsController } from './mail/emails.controller';
import { MeController } from './me/me.controller';
import { ParentsController } from './parents/parents.controller';
import { PermissionsController } from './permissions/permissions.controller';
import { PaymentsController } from './payments/payments.controller';
import { LateInstallmentsService } from './payments/late-installments.service';
import { PaymentsService } from './payments/payments.service';
import { PlayersImportController } from './players/import/players-import.controller';
import { PlayersImportService } from './players/import/players-import.service';
import { FederationAdminController } from './federation/federation-admin.controller';
import { FederationController } from './federation/federation.controller';
import { ReenrollmentController } from './seasons/reenrollment.controller';
import { ExpensesController } from './expenses/expenses.controller';
import { AvailabilityController } from './availability/availability.controller';
import { TournamentsController } from './tournaments/tournaments.controller';
import { PushController } from './push/push.controller';
import { PushService } from './push/push.service';
import { TournamentsService } from './tournaments/tournaments.service';
import { BroadcastsController } from './notifications/broadcasts.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { ReceiptsController } from './receipts/receipts.controller';
import { ReceiptsService } from './receipts/receipts.service';
import { PlayersController } from './players/players.controller';
import { PlayersService } from './players/players.service';
import { PrismaModule } from './prisma/prisma.module';
import { ReservationsController } from './reservations/reservations.controller';
import { ReservationsService } from './reservations/reservations.service';
import { SalariesController } from './salaries/salaries.controller';
import { SalariesService } from './salaries/salaries.service';
import { SeasonsModule } from './seasons/seasons.module';
import { SettingsController } from './settings/settings.controller';
import { StaffController } from './staff/staff.controller';

@Module({
  imports: [PrismaModule, CoreModule, SeasonsModule],
  controllers: [
    UpdatesController,
    HealthController,
    AuthController,
    MeController,
    DashboardController,
    PlanningController,
    SeasonStatsController,
    FinanceStatsController,
    PlayersController,
    ParentsController,
    CoachesController,
    StaffController,
    CoachAbsencesController,
    GroupsController,
    CourtsController,
    CategoriesController,
    FeesController,
    CourtRatesController,
    ReservationsController,
    SalariesController,
    PaymentsController,
    ReceiptsController,
    BroadcastsController,
    NotificationsController,
    FederationController,
    FederationAdminController,
    ReenrollmentController,
    ExpensesController,
    AvailabilityController,
    TournamentsController,
    PushController,
    PlayersImportController,
    AttendanceController,
    SessionReviewController,
    ProgressController,
    EvaluationsController,
    ExercisesController,
    PaymentAccessController,
    MatchesController,
    EventsController,
    EmailsController,
    AuditController,
    SettingsController,
    PermissionsController,
  ],
  providers: [
    UpdatesService,
    LoginThrottle,
    PermissionsCodeService,
    PermissionsCodeGuard,
    PlayersService,
    PaymentsService,
    LateInstallmentsService,
    TournamentsService,
    PushService,
    ReceiptsService,
    PlayersImportService,
    ReservationsService,
    SalariesService,
    { provide: APP_GUARD, useClass: AuthGuard }, // JWT global : @Public pour les exceptions
  ],
})
export class AppModule {}
