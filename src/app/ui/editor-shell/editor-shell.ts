import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { EditorFacade } from '../../application/editor-facade';
import { SaveStatus } from '../../application/auto-save';
import { Icon, IconName } from '../icon/icon';
import { MapCanvas } from '../map-canvas/map-canvas';
import { MapList } from '../map-list/map-list';
import { NewMapDialog, NewMapRequest } from '../new-map-dialog/new-map-dialog';
import { ToolPanel, toolForKey } from '../tool-panel/tool-panel';

type SectionId = 'maps' | 'relief' | 'climate' | 'water' | 'names';

interface SectionDef {
  readonly id: SectionId;
  readonly icon: IconName;
  /** Caption shown under the icon. */
  readonly short: string;
  /** Tooltip / accessible name. */
  readonly label: string;
  readonly available: boolean;
}

const SECTIONS: readonly SectionDef[] = [
  { id: 'maps', icon: 'maps', short: 'Cartes', label: 'Mes cartes', available: true },
  { id: 'relief', icon: 'relief', short: 'Relief', label: 'Relief', available: true },
  { id: 'climate', icon: 'climate', short: 'Climat', label: 'Climat — bientôt', available: false },
  { id: 'water', icon: 'water', short: 'Eaux', label: 'Eaux — bientôt', available: false },
  { id: 'names', icon: 'names', short: 'Noms', label: 'Noms — bientôt', available: false },
];

const SAVE_STATUS_LABELS: Record<SaveStatus, string> = {
  idle: '',
  pending: 'Modifications non enregistrées',
  saving: 'Enregistrement…',
  saved: 'Enregistré',
  error: 'Échec de l’enregistrement',
};

@Component({
  selector: 'cc-editor-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, MapCanvas, MapList, NewMapDialog, ToolPanel],
  host: {
    '(window:keydown)': 'onKeydown($event)',
  },
  template: `
    <nav class="sections" aria-label="Sections">
      <div class="logo" title="Cartocraft"><cc-icon name="compass" [size]="20" /></div>
      @for (section of sections; track section.id) {
        <button
          type="button"
          class="cc-nav-btn shape-tampon"
          [disabled]="!section.available || (section.id !== 'maps' && !facade.hasMap())"
          [attr.aria-current]="activeSection() === section.id ? 'page' : null"
          [attr.aria-label]="section.label"
          [title]="section.label"
          (click)="activeSection.set(section.id)"
        >
          <cc-icon [name]="section.icon" [size]="18" [strokeWidth]="2" />
          <span>{{ section.short }}</span>
        </button>
      }
    </nav>

    <aside class="panel">
      @switch (activeSection()) {
        @case ('maps') {
          <cc-map-list />
        }
        @case ('relief') {
          <cc-tool-panel />
        }
      }

      <div class="actions">
        <div class="file-actions">
          <button type="button" class="cc-btn shape-sceau" title="Créer une nouvelle carte" (click)="newMapDialog.open()">
            <cc-icon name="plus" [size]="15" [strokeWidth]="2.6" />
            <span class="cc-caption">Nouvelle</span>
          </button>
          <label class="cc-btn shape-sceau" title="Importer un fichier .cartocraft">
            <cc-icon name="import" [size]="15" [strokeWidth]="2.4" />
            <span class="cc-caption">Importer</span>
            <input type="file" class="visually-hidden" aria-label="Importer une carte" [accept]="facade.fileExtension" (change)="import($event)" />
          </label>
          <button type="button" class="cc-btn shape-sceau" title="Exporter en fichier .cartocraft" [disabled]="!facade.hasMap()" (click)="export()">
            <cc-icon name="export" [size]="15" [strokeWidth]="2.4" />
            <span class="cc-caption">Exporter</span>
          </button>
        </div>
        <div class="history-actions">
          <button
            type="button"
            class="cc-btn shape-sceau"
            [title]="'Ctrl+Z' + (facade.undoLabel() ? ' — ' + facade.undoLabel() : '')"
            [disabled]="!facade.undoLabel()"
            (click)="facade.undo()"
          >
            <cc-icon name="undo" [size]="14" [strokeWidth]="2.4" />
            <span class="cc-caption">Annuler</span>
          </button>
          <button
            type="button"
            class="cc-btn shape-sceau"
            [title]="'Ctrl+Y' + (facade.redoLabel() ? ' — ' + facade.redoLabel() : '')"
            [disabled]="!facade.redoLabel()"
            (click)="facade.redo()"
          >
            <cc-icon name="redo" [size]="14" [strokeWidth]="2.4" />
            <span class="cc-caption">Rétablir</span>
          </button>
        </div>
      </div>
    </aside>

    <main class="main">
      @if (facade.error(); as error) {
        <div class="error cc-panel" role="alert">
          <span>{{ error }}</span>
          <button type="button" class="cc-btn shape-sceau dismiss" aria-label="Fermer" (click)="facade.dismissError()">
            <cc-icon name="close" [size]="12" [strokeWidth]="3" />
          </button>
        </div>
      }

      @if (facade.hasMap()) {
        <header class="title">
          <input
            class="map-name"
            aria-label="Nom de la carte"
            [value]="facade.mapName()"
            (change)="rename($event)"
            (keydown.enter)="blur($event)"
          />
          <span class="save" [class]="'save save--' + facade.saveStatus()" [title]="saveLabel()" role="status" [attr.aria-label]="saveLabel()"></span>
        </header>
        <div class="frame">
          <div class="frame-inner"><cc-map-canvas /></div>
        </div>
      } @else {
        <div class="empty">
          <button type="button" class="cc-btn cc-btn--primary shape-tampon" (click)="newMapDialog.open()">
            <cc-icon name="plus" [size]="16" [strokeWidth]="2.6" /> Nouvelle carte
          </button>
        </div>
      }
    </main>

    <cc-new-map-dialog #newMapDialog (create)="create($event)" />
  `,
  styles: `
    :host { display: flex; height: 100vh; }

    .sections { width: 64px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 12px 0; background: var(--cc-side); }
    .logo { width: 34px; height: 34px; margin-bottom: 6px; display: flex; align-items: center; justify-content: center; background: var(--cc-accent); color: var(--cc-ink); border: var(--cc-border) solid var(--cc-side-fg); }

    .panel { width: 208px; flex: none; display: flex; flex-direction: column; gap: 14px; padding: 14px 12px; border-right: var(--cc-border-strong) solid var(--cc-ink); overflow: auto; }
    .actions { margin-top: auto; display: flex; flex-direction: column; gap: 8px; }
    .file-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .file-actions .cc-btn { flex-direction: column; gap: 4px; height: 46px; --cc-radius: 14px; --cc-shadow: 2px; }
    .history-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    .history-actions .cc-btn { height: 28px; --cc-shadow: 2px; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding: 12px 16px 16px; }
    .title { display: flex; align-items: center; gap: 12px; border-bottom: var(--cc-border) solid var(--cc-ink); padding-bottom: 4px; }
    .map-name { flex: 1; min-width: 0; border: 0; background: transparent; color: inherit; font-family: var(--cc-font-map); font-size: 26px; line-height: 1.15; letter-spacing: 0.5px; outline: none; }
    .map-name:focus-visible { background: var(--cc-panel); }
    .save { width: 12px; height: 12px; border-radius: 50%; border: var(--cc-border) solid var(--cc-ink); background: var(--cc-panel); }
    .save--saved { background: var(--cc-ok); }
    .save--pending, .save--saving { background: var(--cc-accent); }
    .save--error { background: var(--cc-danger); }

    .frame { flex: 1; min-height: 0; position: relative; background: var(--cc-panel); border: var(--cc-border-strong) solid var(--cc-ink); box-shadow: 5px 5px 0 var(--cc-ink); }
    .frame-inner { position: absolute; inset: 6px; border: 1px solid var(--cc-ink); overflow: hidden; }

    .error { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.4rem 0.6rem; background: var(--cc-danger); color: var(--cc-panel); font-weight: 600; }
    .dismiss { width: 26px; height: 26px; --cc-shadow: 2px; }
    .empty { flex: 1; display: flex; align-items: center; justify-content: center; }
  `,
})
export class EditorShell implements OnInit {
  protected readonly facade = inject(EditorFacade);
  protected readonly sections = SECTIONS;
  protected readonly activeSection = signal<SectionId>('maps');
  protected readonly saveLabel = computed(() => SAVE_STATUS_LABELS[this.facade.saveStatus()]);

  constructor() {
    // Opening a map jumps to the relief tools; closing the last one returns to the list.
    let previousId: string | null = null;
    effect(() => {
      const id = this.facade.currentMapId();
      if (id !== previousId) this.activeSection.set(id ? 'relief' : 'maps');
      previousId = id;
    });
  }

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
    if (!(event.ctrlKey || event.metaKey)) {
      const tool = event.altKey ? null : toolForKey(event.key);
      if (tool && this.facade.hasMap()) {
        this.facade.selectTool(tool);
        this.activeSection.set('relief');
      }
      return;
    }
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
