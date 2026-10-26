import { AiImportController } from './ai/ai-import.controller';
import { BudgetController } from './budget/budget.controller';
import { ProjectsController } from './budget/projects.controller';
import { HistoryController } from './history/history.controller';
import { HistoryService } from './history/history.service';
import { SeasonReportsController } from './reports/season-reports.controller';
import { SeasonReportsService } from './reports/season-reports.service';
import { AiImportService } from './ai/ai-import.service';
import { UpdatesController } from './imports/updates.controller';
import { UpdatesService } from './imports/updates.service';
import { LoginThrottle } from './security/login-throttle';
import { PermissionsCodeGuard, PermissionsCodeService } from './permissions/permissions-code';
import { Module } from '@nestjs/common';
import { AlertsController } from './alerts/alerts.controller';
import { AlertsService } from './alerts/alerts.service';
import { APP_GUARD } from '@nestjs/core';
import { CoachAbsencesController } from './absences/coach-absences.controller';
import { AttendanceController } from './attendance/attendance.controller';
import { SessionChangesController, SessionCounterController } from './attendance/session-counter.controller';
import { SessionReviewController } from './attendance/session-review.controller';
import { ProgressController } from './attendance/progress.controller';
import { EvaluationsController } from './evaluations/evaluations.controller';
import { ExercisesController } from './exercises/exercises.controller';
import { PaymentAccessController } from './access/payment-access.controller';
import { MatchesController } from './matches/matches.controller';
import { AuditController } from './audit/audit.controller';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { ModulesController } from './modules/modules.controller';
import { ModulesGuard } from './modules/modules';
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
import { EventsService } from './events/events.service';
import { FeesController } from './fees/fees.controller';
import { GroupsController } from './groups/groups.controller';
import { TempSchedulesController } from './schedules/temp-schedules.controller';
import { TimetableController } from './schedules/timetable.controller';
import { HealthController } from './health.controller';
import { EmailsController } from './mail/emails.controller';
import { MeController } from './me/me.controller';
import { ParentsController } from './parents/parents.controller';
import { InvitationsController, ParentInvitationsController } from './invitations/invitations.controller';
import { PermissionsController } from './permissions/permissions.controller';
import { PaymentsController } from './payments/payments.controller';
import { LateInstallmentsService } from './payments/late-installments.service';
import { PaymentsService } from './payments/payments.service';
import { PaymentConfigService } from './payments/payment-config.service';
import { PaymentTemplatesController } from './payments/payment-templates.controller';
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
import { BookingRulesService } from './reservations/booking-rules.service';
import { PhotosController } from './photos/photos.controller';
import { ComplaintsController } from './complaints/complaints.controller';
import { AlbumsController } from './albums/albums.controller';
import { AlbumsService } from './albums/albums.service';
import { ComplaintsService } from './complaints/complaints.service';
import { PhotosService } from './photos/photos.service';
import { SalariesController } from './salaries/salaries.controller';
import { SalariesService } from './salaries/salaries.service';
import { SeasonsModule } from './seasons/seasons.module';
import { SettingsController } from './settings/settings.controller';
import { StaffController } from './staff/staff.controller';

@Module({
  imports: [PrismaModule, CoreModule, SeasonsModule],
  controllers: [
    AlertsController,
    AiImportController,
    SeasonReportsController,
    HistoryController,
    ProjectsController,
    BudgetController,
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
    ParentInvitationsController,
    InvitationsController,
    CoachesController,
    StaffController,
    CoachAbsencesController,
    GroupsController,
    TempSchedulesController,
    TimetableController,
    CourtsController,
    CategoriesController,
    FeesController,
    CourtRatesController,
    ReservationsController,
    SalariesController,
    PaymentsController,
    ReceiptsController,
    PaymentTemplatesController,
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
    SessionCounterController,
    SessionChangesController,
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
    PhotosController,
    ComplaintsController,
    AlbumsController,
    ModulesController,
  ],
  providers: [
    AlertsService,
    AiImportService,
    SeasonReportsService,
    HistoryService,
    UpdatesService,
    LoginThrottle,
    PermissionsCodeService,
    PermissionsCodeGuard,
    PlayersService,
    PaymentsService,
    PaymentConfigService,
    LateInstallmentsService,
    TournamentsService,
    PushService,
    ReceiptsService,
    PlayersImportService,
    ReservationsService,
    BookingRulesService,
    SalariesService,
    PhotosService,
    ComplaintsService,
    AlbumsService,
    EventsService,
    { provide: APP_GUARD, useClass: ModulesGuard }, // module coupé (MODULES_COUPES) : 404, avant la connexion
    { provide: APP_GUARD, useClass: AuthGuard }, // JWT global : @Public pour les exceptions
  ],
})
export class AppModule {}
