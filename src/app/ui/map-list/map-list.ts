import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { EditorFacade } from '../../application/editor-facade';
import { MapSummary } from '../../domain/map/map-repository';

@Component({
  selector: 'cc-map-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <h2>Mes cartes</h2>
    @for (map of facade.savedMaps(); track map.id) {
      <article [class.current]="map.id === facade.currentMapId()">
        <button type="button" class="open" (click)="facade.openMap(map.id)">
          <strong>{{ map.name }}</strong>
          <small>{{ map.widthKm }} × {{ map.heightKm }} km · {{ map.updatedAt | date: 'short' }}</small>
        </button>
        <div class="actions">
          <button type="button" title="Dupliquer" (click)="facade.duplicateMap(map.id)">⧉</button>
          <button type="button" title="Supprimer" (click)="remove(map)">🗑</button>
        </div>
      </article>
    } @empty {
      <p class="empty">Aucune carte enregistrée.</p>
    }
  `,
  styles: `
    :host { display: block; padding: 0.75rem; }
    h2 { font-family: Georgia, serif; font-size: 1.1rem; margin: 0 0 0.5rem; }
    article { display: flex; align-items: stretch; gap: 0.25rem; margin-bottom: 0.35rem; border-radius: 4px; }
    article.current { background: #e2d5b8; }
    .open { flex: 1; display: flex; flex-direction: column; text-align: left; background: none; border: none; padding: 0.35rem; cursor: pointer; font: inherit; }
    .actions { display: flex; align-items: center; }
    .actions button { background: none; border: none; cursor: pointer; }
    small { color: #7a6a50; }
    .empty { color: #7a6a50; font-style: italic; }
  `,
})
export class MapList {
  protected readonly facade = inject(EditorFacade);

  protected remove(map: MapSummary): void {
    if (confirm(`Supprimer définitivement « ${map.name} » ?`)) void this.facade.deleteMap(map.id);
  }
}
