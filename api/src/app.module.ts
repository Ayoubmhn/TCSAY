import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AttendanceController } from './attendance/attendance.controller';
import { AuditController } from './audit/audit.controller';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { CategoriesController } from './categories/categories.controller';
import { CoachesController } from './coaches/coaches.controller';
import { CoreModule } from './core.module';
import { CourtRatesController } from './court-rates/court-rates.controller';
import { CourtsController } from './courts/courts.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { EventsController } from './events/events.controller';
import { FeesController } from './fees/fees.controller';
import { GroupsController } from './groups/groups.controller';
import { HealthController } from './health.controller';
import { EmailsController } from './mail/emails.controller';
import { MeController } from './me/me.controller';
import { ParentsController } from './parents/parents.controller';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { PlayersController } from './players/players.controller';
import { PlayersService } from './players/players.service';
import { PrismaModule } from './prisma/prisma.module';
import { ReservationsController } from './reservations/reservations.controller';
import { ReservationsService } from './reservations/reservations.service';
import { SalariesController } from './salaries/salaries.controller';
import { SeasonsModule } from './seasons/seasons.module';
import { SettingsController } from './settings/settings.controller';

@Module({
  imports: [PrismaModule, CoreModule, SeasonsModule],
  controllers: [
    HealthController,
    AuthController,
    MeController,
    DashboardController,
    PlayersController,
    ParentsController,
    CoachesController,
    GroupsController,
    CourtsController,
    CategoriesController,
    FeesController,
    CourtRatesController,
    ReservationsController,
    SalariesController,
    PaymentsController,
    AttendanceController,
    EventsController,
    EmailsController,
    AuditController,
    SettingsController,
  ],
  providers: [
    PlayersService,
    PaymentsService,
    ReservationsService,
    { provide: APP_GUARD, useClass: AuthGuard }, // JWT global : @Public pour les exceptions
  ],
})
export class AppModule {}
