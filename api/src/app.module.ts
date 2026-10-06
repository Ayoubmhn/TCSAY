import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { SeasonsModule } from './seasons/seasons.module';

@Module({
  imports: [PrismaModule, SeasonsModule],
  controllers: [HealthController],
})
export class AppModule {}
