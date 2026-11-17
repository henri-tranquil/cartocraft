import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EditorFacade } from '../../application/editor-facade';
import { MapSummary } from '../../domain/map/map-repository';

/** "Pangea" → "Pa", "Terres du Nord" → "TN": short enough for a 40 px square. */
export function mapInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w.length > 0 && w[0] === w[0].toUpperCase());
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const word = name.trim() || '?';
  return word[0].toUpperCase() + (word[1] ?? '').toLowerCase();
}

/** Saved maps as small squares in the dark edge bar. */
@Component({
  selector: 'cc-map-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (map of facade.savedMaps(); track map.id) {
      <button
        type="button"
        class="square"
        [attr.aria-current]="map.id === facade.currentMapId() ? 'true' : null"
        [attr.aria-label]="'Ouvrir ' + map.name"
        [title]="tooltip(map)"
        (click)="facade.openMap(map.id)"
      >
        {{ initials(map.name) }}
      </button>
    } @empty {
      <p class="empty">Aucune carte enregistrée</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .square {
      width: 40px; height: 40px; flex: none; padding: 0;
      font-family: var(--cc-font-map); font-size: 17px; line-height: 1;
      background: var(--cc-panel); color: var(--cc-ink);
      border: var(--cc-border) solid var(--cc-side-fg); cursor: pointer;
      transition: transform 80ms ease;
    }
    .square:hover { transform: translate(-1px, -1px); box-shadow: 2px 2px 0 var(--cc-side-fg); }
    .square[aria-current='true'] { background: var(--cc-accent); box-shadow: 3px 3px 0 var(--cc-side-fg); }
    .square:focus-visible { outline: 2px solid var(--cc-accent); outline-offset: 2px; }
    .empty { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  `,
})
export class MapList {
  protected readonly facade = inject(EditorFacade);
  protected readonly initials = mapInitials;

  protected tooltip(map: MapSummary): string {
    const date = new Date(map.updatedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `${map.name}\n${map.widthKm} × ${map.heightKm} km · modifiée le ${date}`;
  }
}
