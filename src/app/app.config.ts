import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { MAP_FILE_CODEC, MAP_REPOSITORY } from './application/ports';
import { IndexedDbMapRepository } from './infrastructure/persistence/indexed-db-map-repository';
import { cartocraftFileCodec } from './infrastructure/persistence/map-file';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: MAP_REPOSITORY, useFactory: () => new IndexedDbMapRepository() },
    { provide: MAP_FILE_CODEC, useValue: cartocraftFileCodec },
  ],
};
