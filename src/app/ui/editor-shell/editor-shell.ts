import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { EditorFacade } from '../../application/editor-facade';
import { SaveStatus } from '../../application/auto-save';
import { MapList } from '../map-list/map-list';
import { NewMapDialog, NewMapRequest } from '../new-map-dialog/new-map-dialog';

const SAVE_STATUS_LABELS: Record<SaveStatus, string> = {
  idle: '',
  pending: 'Modifications non enregistrées…',
  saving: 'Enregistrement…',
  saved: 'Enregistré',
  error: 'Échec de l’enregistrement',
};

@Component({
  selector: 'cc-editor-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MapList, NewMapDialog],
  host: {
    '(window:keydown)': 'onKeydown($event)',
  },
  template: `
    <header class="toolbar">
      <strong class="brand">Cartocraft</strong>
      <button type="button" (click)="newMapDialog.open()">Nouvelle carte</button>
      <label class="file-button">
        Importer…
        <input type="file" [accept]="facade.fileExtension" (change)="import($event)" />
      </label>
      @if (facade.hasMap()) {
        <button type="button" (click)="export()">Exporter</button>
        <span class="separator"></span>
        <input
          class="name"
          aria-label="Nom de la carte"
          [value]="facade.mapName()"
          (change)="rename($event)"
          (keydown.enter)="blur($event)"
        />
        <button type="button" [disabled]="!facade.undoLabel()" [title]="'Annuler : ' + (facade.undoLabel() ?? '')" (click)="facade.undo()">
          ↶ Annuler
        </button>
        <button type="button" [disabled]="!facade.redoLabel()" [title]="'Rétablir : ' + (facade.redoLabel() ?? '')" (click)="facade.redo()">
          ↷ Rétablir
        </button>
        <span class="save-status" [class.error]="facade.saveStatus() === 'error'">{{ saveLabel() }}</span>
      }
    </header>

    @if (facade.error(); as error) {
      <div class="error-banner" role="alert">
        {{ error }}
        <button type="button" (click)="facade.dismissError()">✕</button>
      </div>
    }

    <div class="body">
      <aside><cc-map-list /></aside>
      <main class="content">
        @if (facade.mapSummary(); as summary) {
          <p>
            {{ summary.widthKm }} × {{ summary.heightKm }} km — grille {{ summary.widthCells }} × {{ summary.heightCells }}
            cellules, {{ summary.tileCount }} tuiles.
          </p>
          <p class="hint">Le canevas arrive à l'étape 3 (relief).</p>
        } @else {
          <p>Aucune carte ouverte.</p>
        }
      </main>
    </div>

    <cc-new-map-dialog #newMapDialog (create)="create($event)" />
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; }
    .toolbar { display: flex; gap: 0.5rem; align-items: center; padding: 0.5rem 1rem; border-bottom: 1px solid #c8b99a; background: #efe6d2; }
    .brand { margin-right: 1rem; font-family: Georgia, serif; }
    .separator { width: 1px; align-self: stretch; background: #c8b99a; margin: 0 0.5rem; }
    .name { font: inherit; padding: 0.2rem 0.4rem; }
    .file-button { cursor: pointer; padding: 1px 6px; border: 1px solid #767676; border-radius: 2px; background: #efefef; font-size: 0.85em; }
    .file-button input { display: none; }
    .save-status { margin-left: auto; color: #7a6a50; font-size: 0.85em; }
    .save-status.error { color: #a03020; }
    .error-banner { display: flex; justify-content: space-between; padding: 0.5rem 1rem; background: #f3d6cf; color: #7a2010; }
    .error-banner button { background: none; border: none; cursor: pointer; }
    .body { flex: 1; display: flex; min-height: 0; }
    aside { width: 16rem; border-right: 1px solid #c8b99a; background: #f6efe0; overflow: auto; }
    .content { flex: 1; padding: 1rem; }
    .hint { color: #7a6a50; font-style: italic; }
  `,
})
export class EditorShell implements OnInit {
  protected readonly facade = inject(EditorFacade);
  protected readonly saveLabel = computed(() => SAVE_STATUS_LABELS[this.facade.saveStatus()]);

  ngOnInit(): void {
    void this.facade.restoreLastSession();
  }

  protected create(request: NewMapRequest): void {
    void this.facade.createBlankMap(request.settings, request.name);
  }

  protected async import(event: Event): Promise<void> {
    if (!(event.target instanceof HTMLInputElement)) return;
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-importing the same file
    if (file) await this.facade.importMapFile(file);
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

  protected rename(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.facade.renameMap(event.target.value);
  }

  protected blur(event: Event): void {
    if (event.target instanceof HTMLInputElement) event.target.blur();
  }

  protected onKeydown(event: KeyboardEvent): void {
    // Let text fields keep their native undo.
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.facade.undo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      this.facade.redo();
    }
  }
}
