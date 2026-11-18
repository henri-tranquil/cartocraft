import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { CLIMATE_ENGINE, DRAWING_WEATHER_ENGINE, MAP_FILE_CODEC, MAP_REPOSITORY, WORLD_CONVERTER } from './application/ports';
import { IndexedDbMapRepository } from './infrastructure/persistence/indexed-db-map-repository';
import { cartocraftFileCodec } from './infrastructure/persistence/map-file';
import { WorkerClimateEngine } from './infrastructure/workers/worker-climate-engine';
import { WorkerWorldConverter } from './infrastructure/workers/worker-world-converter';
import { WorkerDrawingWeatherEngine } from './infrastructure/workers/worker-drawing-weather-engine';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: MAP_REPOSITORY, useFactory: () => new IndexedDbMapRepository() },
    { provide: MAP_FILE_CODEC, useValue: cartocraftFileCodec },
    { provide: CLIMATE_ENGINE, useFactory: () => new WorkerClimateEngine() },
    { provide: WORLD_CONVERTER, useFactory: () => new WorkerWorldConverter() },
    { provide: DRAWING_WEATHER_ENGINE, useFactory: () => new WorkerDrawingWeatherEngine() },
  ],
};
