import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth-user';
import { WeatherService } from './weather.service';

/**
 * Météo à Sayada (bouton en haut à droite, planning). Publique : aucune donnée personnelle (prévision du club seulement),
 * ce qui permet aussi de la vérifier dans un navigateur (`error` dit pourquoi elle manque). Information seulement,
 * rien n'est annulé automatiquement.
 */
@ApiTags('Météo')
@Public()
@Controller('weather')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get()
  get() {
    return this.weather.get();
  }
}
