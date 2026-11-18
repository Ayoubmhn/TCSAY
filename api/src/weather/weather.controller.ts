import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude } from 'class-validator';
import { Public } from '../auth/auth-user';
import { WeatherService } from './weather.service';

class HereQuery {
  @Type(() => Number)
  @IsLatitude({ message: 'Latitude invalide.' })
  lat!: number;

  @Type(() => Number)
  @IsLongitude({ message: 'Longitude invalide.' })
  lon!: number;
}

/**
 * Météo à Sayada (bouton en haut à droite, planning). Information seulement, rien n'est annulé automatiquement.
 */
@ApiTags('Météo')
@Controller('weather')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  /** Météo du club. Publique : aucune donnée personnelle ; `error` dit pourquoi elle manque (vérifiable dans un navigateur). */
  @Get()
  @Public()
  get() {
    return this.weather.get();
  }

  /**
   * Météo à la position de la personne connectée (si elle l'a autorisée sur son appareil), pour la comparer au club.
   * Position arrondie à 0,1° (environ 10 km) par l'appareil puis par l'API, jamais enregistrée.
   */
  @Get('here')
  @ApiBearerAuth()
  here(@Query() q: HereQuery) {
    return this.weather.here(q.lat, q.lon);
  }
}
