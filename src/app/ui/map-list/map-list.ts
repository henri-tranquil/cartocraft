import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { EditorFacade } from '../../application/editor-facade';
import { MapSummary } from '../../domain/map/map-repository';
import { Icon } from '../icon/icon';

@Component({
  selector: 'cc-map-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, Icon],
  template: `
    @for (map of facade.savedMaps(); track map.id) {
      <article class="card" [class.current]="map.id === facade.currentMapId()">
        <button type="button" class="open" [title]="'Ouvrir ' + map.name" (click)="facade.openMap(map.id)">
          <span class="name">{{ map.name }}</span>
          <span class="meta">{{ map.widthKm }} × {{ map.heightKm }} km · {{ map.updatedAt | date: 'd MMM HH:mm' }}</span>
        </button>
        <div class="actions">
          <button type="button" class="cc-btn shape-sceau" aria-label="Dupliquer" title="Dupliquer" (click)="facade.duplicateMap(map.id)">
            <cc-icon name="copy" [size]="12" [strokeWidth]="2.4" />
          </button>
          <button type="button" class="cc-btn shape-sceau" aria-label="Supprimer" title="Supprimer" (click)="remove(map)">
            <cc-icon name="trash" [size]="12" [strokeWidth]="2.4" />
          </button>
        </div>
      </article>
    } @empty {
      <p class="empty">Aucune carte enregistrée.</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; }
    .card { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 10px; background: var(--cc-bg); border: var(--cc-border) solid var(--cc-ink); }
    .card.current { background: var(--cc-panel); box-shadow: var(--cc-shadow) var(--cc-shadow) 0 var(--cc-active); }
    .open { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; text-align: left; background: none; border: 0; padding: 0; color: inherit; cursor: pointer; font: inherit; }
    .name { font-family: var(--cc-font-map); font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { font-size: 11px; font-weight: 500; color: var(--cc-muted); }
    .actions { display: flex; gap: 6px; }
    .actions .cc-btn { width: 24px; height: 24px; --cc-shadow: 2px; }
    .empty { font-style: italic; color: var(--cc-muted); }
  `,
})
export class MapList {
  protected readonly facade = inject(EditorFacade);

  protected remove(map: MapSummary): void {
    if (confirm(`Supprimer définitivement « ${map.name} » ?`)) void this.facade.deleteMap(map.id);
  }
}
