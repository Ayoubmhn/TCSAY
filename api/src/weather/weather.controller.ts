import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { WeatherService } from './weather.service';

/** Météo à Sayada (bouton en haut à droite, planning) : tous les comptes connectés. Information seulement, rien n'est annulé automatiquement. */
@ApiTags('Météo')
@ApiBearerAuth()
@Controller('weather')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get()
  get() {
    return this.weather.get();
  }
}
