import { InjectionToken } from '@angular/core';
import { ClimateEngine } from '../domain/climate/climate-engine';
import { MapFileCodec, MapRepository } from '../domain/map/map-repository';

/** Implementations are bound in app.config.ts (composition root), keeping application → infrastructure free. */
export const MAP_REPOSITORY = new InjectionToken<MapRepository>('MapRepository');
export const MAP_FILE_CODEC = new InjectionToken<MapFileCodec>('MapFileCodec');
export const CLIMATE_ENGINE = new InjectionToken<ClimateEngine>('ClimateEngine');
