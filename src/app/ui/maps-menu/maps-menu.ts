import { ChangeDetectionStrategy, Component, ElementRef, inject, output, signal } from '@angular/core';
import { EditorFacade } from '../../application/editor-facade';
import { MapSummary } from '../../domain/map/map-repository';
import { Icon } from '../icon/icon';

/**
 * "Mes cartes" drop-down of the top bar: open a saved map, create or import
 * one, and act on the open map (export, duplicate, delete).
 * Dialogs live in the shell: this menu only asks for them (`newMap`, `sketch`).
 */
@Component({
  selector: 'cc-maps-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: {
    '(document:pointerdown)': 'onOutside($event)',
    '(document:keydown.escape)': 'open.set(false)',
  },
  template: `
    <button type="button" class="trigger" [attr.aria-expanded]="open()" aria-haspopup="menu" (click)="open.set(!open())">
      Mes cartes <cc-icon name="chevronDown" [size]="14" [strokeWidth]="2.4" />
    </button>
    @if (open()) {
      <div class="menu" role="menu">
        @for (map of facade.savedMaps(); track map.id) {
          <button type="button" role="menuitem" class="item" [class.current]="map.id === facade.currentMapId()" (click)="choose(map)">
            <span class="name">{{ map.name }}</span>
            <small>{{ details(map) }}</small>
          </button>
        } @empty {
          <p class="none">Aucune carte enregistrée.</p>
        }
        <hr />
        <button type="button" role="menuitem" class="item" (click)="close(); newMap.emit()">
          <span class="name"><cc-icon name="plus" [size]="14" [strokeWidth]="2.6" /> Nouvelle carte</span>
          <small>part d’une mer vide, à dessiner</small>
        </button>
        <label class="item" role="menuitem">
          <span class="name"><cc-icon name="import" [size]="14" [strokeWidth]="2.4" /> Importer un fichier…</span>
          <small>.cartocraft, crée une nouvelle carte</small>
          <input type="file" class="visually-hidden" [accept]="facade.fileExtension" (change)="importFile($event)" />
        </label>
        <label class="item" role="menuitem">
          <span class="name"><cc-icon name="sketch" [size]="14" [strokeWidth]="2.2" /> Importer un croquis…</span>
          <small>image d’une carte dessinée sur papier</small>
          <input type="file" class="visually-hidden" accept="image/*" (change)="importSketch($event)" />
        </label>
        @if (facade.hasMap()) {
          <hr />
          <p class="group">Carte ouverte</p>
          <button type="button" role="menuitem" class="item" (click)="close(); export()">
            <span class="name"><cc-icon name="export" [size]="14" [strokeWidth]="2.4" /> Exporter</span>
            <small>fichier {{ facade.fileExtension }} à garder ou partager</small>
          </button>
          <button type="button" role="menuitem" class="item" (click)="close(); duplicate()">
            <span class="name"><cc-icon name="copy" [size]="14" [strokeWidth]="2.4" /> Dupliquer</span>
          </button>
          <button type="button" role="menuitem" class="item danger" (click)="close(); remove()">
            <span class="name"><cc-icon name="trash" [size]="14" [strokeWidth]="2.4" /> Supprimer…</span>
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; }
    .trigger {
      display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; cursor: pointer; font: inherit; font-weight: 600;
      background: transparent; color: var(--cc-side-fg); border: 1px solid var(--cc-side-line); border-radius: var(--cc-radius-soft);
    }
    .trigger:hover, .trigger[aria-expanded='true'] { border-color: var(--cc-accent); }
    .menu {
      position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; width: 270px; max-height: 70vh; overflow-y: auto;
      display: flex; flex-direction: column; gap: 1px; padding: 6px;
      background: var(--cc-panel); color: var(--cc-ink); border: var(--cc-border) solid var(--cc-ink);
      border-radius: var(--cc-radius-soft); box-shadow: var(--cc-shadow) var(--cc-shadow) 0 var(--cc-ink);
    }
    .item {
      display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 6px 8px; text-align: left; cursor: pointer;
      font: inherit; color: inherit; background: none; border: 0; border-radius: 6px;
    }
    .item:hover, .item:focus-within, .item:focus-visible { background: var(--cc-panel-2); outline: none; }
    .item.current .name { font-weight: 700; }
    .item.current .name::after { content: ' · ouverte'; font-weight: 400; color: var(--cc-muted); }
    .name { display: inline-flex; align-items: center; gap: 6px; }
    small { color: var(--cc-muted); font-size: 11.5px; }
    .danger { color: var(--cc-danger); }
    hr { width: 100%; border: 0; border-top: 1px solid var(--cc-line); margin: 4px 0; }
    .group { margin: 2px 8px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--cc-muted); }
    .none { margin: 6px 8px; color: var(--cc-muted); }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  `,
})
export class MapsMenu {
  protected readonly facade = inject(EditorFacade);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly open = signal(false);

  readonly newMap = output();
  readonly sketch = output<File>();

  protected close(): void {
    this.open.set(false);
  }

  protected onOutside(event: PointerEvent): void {
    if (this.open() && event.target instanceof Node && !this.host.nativeElement.contains(event.target)) this.close();
  }

  protected details(map: MapSummary): string {
    const date = new Date(map.updatedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `${map.widthKm} × ${map.heightKm} km · modifiée le ${date}`;
  }

  protected choose(map: MapSummary): void {
    this.close();
    if (map.id !== this.facade.currentMapId()) void this.facade.openMap(map.id);
  }

  protected importFile(event: Event): void {
    const file = takeFile(event);
    this.close();
    if (file) void this.facade.importMapFile(file);
  }

  protected importSketch(event: Event): void {
    const file = takeFile(event);
    this.close();
    if (file) this.sketch.emit(file);
  }

  protected async export(): Promise<void> {
    const exported = await this.facade.exportCurrentMap();
    if (!exported) return;
    const url = URL.createObjectURL(exported.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exported.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  protected duplicate(): void {
    const id = this.facade.currentMapId();
    if (id) void this.facade.duplicateMap(id);
  }

  protected remove(): void {
    const id = this.facade.currentMapId();
    if (id && confirm(`Supprimer définitivement « ${this.facade.mapName()} » ?`)) void this.facade.deleteMap(id);
  }
}

function takeFile(event: Event): File | null {
  if (!(event.target instanceof HTMLInputElement)) return null;
  const file = event.target.files?.[0] ?? null;
  event.target.value = ''; // allow choosing the same file again
  return file;
}
