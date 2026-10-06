import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('Santé')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: string; database: string; time: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'ok', time: new Date().toString() };
  }
}
