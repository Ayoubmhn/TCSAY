# TCSAY : Tennis Club de Sayada

Plateforme de gestion du club : réservations de terrains, cotisations, groupes, membres, coachs, salaires.

## Structure
- `api/` : API NestJS + Prisma 5 + PostgreSQL (Swagger sur `/api/docs`, préfixe `/api/v1`)
- `web/` : application React (à venir, sprint 1)
- `docs/` : design system et prototype
- `docker-compose.yml` : PostgreSQL 16, Redis, Mailpit

## Démarrage
```bash
docker compose up -d            # PostgreSQL :5432, Redis :6379, Mailpit :1025 / http://localhost:8025
cd api
cp .env.example .env
npm install
npx prisma migrate dev          # applique les migrations
npm run start:dev               # http://localhost:3000/api/docs
```
