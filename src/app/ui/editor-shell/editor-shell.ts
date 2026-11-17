import { ChangeDetectionStrategy, Component, computed, effect, HostListener, inject, OnInit, signal } from '@angular/core';
import { EditorFacade, SketchMapRequest } from '../../application/editor-facade';
import { SaveStatus } from '../../application/auto-save';
import { ClimatePanel } from '../climate-panel/climate-panel';
import { NamesPanel } from '../names-panel/names-panel';
import { Icon, IconName } from '../icon/icon';
import { MapCanvas } from '../map-canvas/map-canvas';
import { MapList } from '../map-list/map-list';
import { NewMapDialog, NewMapRequest } from '../new-map-dialog/new-map-dialog';
import { SketchImportDialog } from '../sketch-import-dialog/sketch-import-dialog';
import { ToolPanel, toolForKey } from '../tool-panel/tool-panel';

import { formatUrlState, parseUrlState, SectionId, UrlState } from '../url-state';

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
  { id: 'relief', icon: 'relief', short: 'Relief', label: 'Relief : sculpter le terrain', available: true },
  { id: 'climate', icon: 'climate', short: 'Climat', label: 'Climat : latitudes, températures, saisons', available: true },
  { id: 'water', icon: 'water', short: 'Eaux', label: 'Eaux — bientôt', available: false },
  { id: 'names', icon: 'names', short: 'Noms', label: 'Noms : villes, sommets, mers, régions', available: true },
  { id: 'render', icon: 'render', short: 'Rendu', label: 'Rendu : la carte illustrée, à l’ancienne', available: true },
];

const SAVE_STATUS_LABELS: Record<SaveStatus, string> = {
  idle: '',
  pending: 'Modifications non enregistrées',
  saving: 'Enregistrement…',
  saved: 'Enregistré',
  error: 'Échec de l’enregistrement',
};

/**
 * Layout, left to right: dark bar (saved maps as squares, new, import),
 * section bar, tool panel (current-map actions at the bottom), then the map.
 */
@Component({
  selector: 'cc-editor-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ClimatePanel, Icon, MapCanvas, MapList, NamesPanel, NewMapDialog, SketchImportDialog, ToolPanel],
  host: {
    '(window:keydown)': 'onKeydown($event)',
  },
  template: `
    <header class="banner">
      <cc-icon class="banner-logo" name="compass" [size]="22" [strokeWidth]="2.2" />
      <h1 class="banner-title">Cartocraft</h1>
      <span class="banner-tagline">atelier de cartes du monde</span>
    </header>
    <div class="body">
    <nav class="maps" aria-label="Mes cartes">
      <cc-map-list class="map-list" />
      <button type="button" class="square-btn" aria-label="Nouvelle carte" title="Créer une nouvelle carte" (click)="newMapDialog.open()">
        <cc-icon name="plus" [size]="18" [strokeWidth]="2.8" />
      </button>
      <label class="square-btn" title="Importer un fichier .cartocraft (crée une nouvelle carte)">
        <cc-icon name="import" [size]="17" [strokeWidth]="2.4" />
        <input type="file" class="visually-hidden" aria-label="Importer une carte" [accept]="facade.fileExtension" (change)="import($event)" />
      </label>
      <label class="square-btn" title="Créer une carte depuis l’image d’un dessin (PNG, JPEG…)">
        <cc-icon name="sketch" [size]="17" [strokeWidth]="2.2" />
        <input type="file" class="visually-hidden" aria-label="Carte depuis un dessin" accept="image/*" (change)="importSketch($event, sketchDialog)" />
      </label>
    </nav>

    <nav class="actions" aria-label="Sections et actions">
      @for (section of sections; track section.id) {
        <button
          type="button"
          class="cc-btn shape-tampon act"
          [class.act--apart]="section.id === 'render'"
          [disabled]="!section.available || !facade.hasMap()"
          [attr.aria-pressed]="facade.hasMap() && activeSection() === section.id"
          [attr.aria-label]="section.label"
          [title]="section.label"
          (click)="activeSection.set(section.id)"
        >
          <cc-icon [name]="section.icon" [size]="17" [strokeWidth]="2" />
          <span class="cc-caption">{{ section.short }}</span>
        </button>
      }
    </nav>

    @if (facade.hasMap()) {
      <aside class="tools" [attr.aria-label]="activeLabel()">
        <h2 class="heading"><cc-icon [name]="activeIcon()" [size]="14" [strokeWidth]="2.4" /> {{ activeShort() }}</h2>
        @switch (activeSection()) {
          @case ('relief') {
            <cc-tool-panel />
          }
          @case ('climate') {
            <cc-climate-panel />
          }
          @case ('names') {
            <cc-names-panel />
          }
          @case ('render') {
            <p class="hint">Vue « carte ancienne », en lecture seule : le clic déplace la carte. Les fleuves viendront ensuite.</p>
          }
        }
        <div class="map-actions">
          <button type="button" class="cc-btn shape-sceau" title="Exporter la carte en fichier .cartocraft" (click)="export()">
            <cc-icon name="export" [size]="15" [strokeWidth]="2.4" />
            <span class="cc-caption">Exporter</span>
          </button>
          <button type="button" class="cc-btn shape-sceau" title="Dupliquer la carte ouverte" (click)="duplicate()">
            <cc-icon name="copy" [size]="15" [strokeWidth]="2.4" />
            <span class="cc-caption">Copier</span>
          </button>
          <button type="button" class="cc-btn cc-btn--danger shape-sceau" title="Supprimer la carte ouverte" (click)="remove()">
            <cc-icon name="trash" [size]="15" [strokeWidth]="2.4" />
            <span class="cc-caption">Suppr.</span>
          </button>
        </div>
      </aside>
    }

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
          <button
            type="button"
            class="cc-btn shape-sceau history"
            [title]="'Ctrl+Z' + (facade.undoLabel() ? ' — ' + facade.undoLabel() : '')"
            [disabled]="!facade.undoLabel()"
            (click)="facade.undo()"
          >
            <cc-icon name="undo" [size]="14" [strokeWidth]="2.4" />
            <span class="cc-caption">Annuler</span>
          </button>
          <button
            type="button"
            class="cc-btn shape-sceau history"
            [title]="'Ctrl+Y' + (facade.redoLabel() ? ' — ' + facade.redoLabel() : '')"
            [disabled]="!facade.redoLabel()"
            (click)="facade.redo()"
          >
            <cc-icon name="redo" [size]="14" [strokeWidth]="2.4" />
            <span class="cc-caption">Rétablir</span>
          </button>
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

    </div>
    <cc-new-map-dialog #newMapDialog (create)="create($event)" />
    <cc-sketch-import-dialog #sketchDialog (create)="createFromSketch($event)" />
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; }
    .banner { flex: none; display: flex; align-items: baseline; gap: 10px; padding: 6px 16px; background: var(--cc-side); color: var(--cc-side-fg); border-bottom: var(--cc-border-strong) solid var(--cc-accent); }
    .banner-logo { align-self: center; color: var(--cc-accent); }
    .banner-title { margin: 0; font-family: var(--cc-font-map); font-weight: 400; font-size: 24px; letter-spacing: 1px; line-height: 1.1; }
    .banner-tagline { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.75; }
    .body { flex: 1; min-height: 0; display: flex; }

    .maps { width: 60px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px 0; background: var(--cc-side); overflow-y: auto; }
    .act--apart { margin-top: 10px; }
    .act--apart::before { content: ''; position: absolute; top: -10px; left: 4px; right: 4px; border-top: var(--cc-border) dashed var(--cc-ink); }
    .hint { margin: 0; font-size: 12px; color: var(--cc-muted); line-height: 1.45; }

    .actions { width: 70px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 0; border-right: var(--cc-border-strong) solid var(--cc-ink); overflow-y: auto; }
    .act { width: 52px; height: 46px; flex: none; flex-direction: column; gap: 3px; --cc-shadow: 2px; }
    .square-btn {
      width: 40px; height: 40px; flex: none; display: flex; align-items: center; justify-content: center; cursor: pointer;
      background: transparent; color: var(--cc-side-fg); border: var(--cc-border) dashed var(--cc-side-fg);
    }
    .square-btn:hover { background: var(--cc-side-fg); color: var(--cc-side); border-style: solid; }
    .square-btn:focus-within, .square-btn:focus-visible { outline: 2px solid var(--cc-accent); outline-offset: 2px; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

    .heading { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
    .map-actions { margin-top: auto; padding-top: 12px; border-top: var(--cc-border) solid var(--cc-ink); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .map-actions .cc-btn { height: 46px; flex-direction: column; gap: 4px; --cc-radius: 14px; --cc-shadow: 2px; }
    .tools { width: 208px; flex: none; display: flex; flex-direction: column; gap: 14px; padding: 14px 12px; border-right: var(--cc-border-strong) solid var(--cc-ink); overflow: auto; }

    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding: 12px 16px 16px; }
    .title { display: flex; align-items: center; gap: 8px; border-bottom: var(--cc-border) solid var(--cc-ink); padding-bottom: 6px; }
    .map-name { flex: 1; min-width: 0; border: 0; background: transparent; color: inherit; font-family: var(--cc-font-map); font-size: 26px; line-height: 1.15; letter-spacing: 0.5px; outline: none; }
    .map-name:focus-visible { background: var(--cc-panel); }
    .history { height: 28px; padding: 0 10px; --cc-shadow: 2px; }
    .save { width: 12px; height: 12px; margin-left: 6px; border-radius: 50%; border: var(--cc-border) solid var(--cc-ink); background: var(--cc-panel); }
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
  protected readonly activeSection = signal<SectionId>('relief');
  private readonly active = computed(() => SECTIONS.find((s) => s.id === this.activeSection()) ?? SECTIONS[0]);
  protected readonly activeLabel = computed(() => this.active().label);
  protected readonly activeIcon = computed(() => this.active().icon);
  protected readonly activeShort = computed(() => this.active().short);
  protected readonly saveLabel = computed(() => SAVE_STATUS_LABELS[this.facade.saveStatus()]);

  /** The URL is written only once the map it names is open (a reload must not erase it first). */
  private readonly started = signal(false);

  constructor() {
    // Address bar ⇄ state: map, section, relief tool, climate view.
    effect(() => {
      if (!this.started()) return;
      const hash = formatUrlState({
        mapId: this.facade.currentMapId() ?? undefined,
        section: this.activeSection(),
        tool: this.facade.activeTool(),
        view: this.facade.viewMode(),
      });
      if (location.hash !== hash) history.replaceState(history.state, '', hash);
    });
    // Only the Relief panel edits the terrain; elsewhere a click just moves the map.
    effect(() => this.facade.setEditingEnabled(this.activeSection() === 'relief'));
    effect(() => this.facade.setRendered(this.activeSection() === 'render'));
    effect(() => this.facade.setNamesEditing(this.activeSection() === 'names'));
    // The latitude ruler belongs to the Climate panel: leaving it closes the ruler.
    effect(() => {
      if (this.activeSection() !== 'climate') this.facade.stopLatitudeEditing();
    });
  }

  ngOnInit(): void {
    const fromUrl = parseUrlState(location.hash);
    this.applyUrlState(fromUrl);
    void this.facade.startUp(fromUrl.mapId).finally(() => this.started.set(true));
  }

  /** The user edited the address (or followed a link) without reloading. */
  @HostListener('window:hashchange')
  protected onHashChange(): void {
    const state = parseUrlState(location.hash);
    this.applyUrlState(state);
    if (state.mapId && state.mapId !== this.facade.currentMapId()) void this.facade.openMap(state.mapId);
  }

  private applyUrlState(state: UrlState): void {
    if (state.section && SECTIONS.some((s) => s.id === state.section && s.available)) this.activeSection.set(state.section);
    if (state.tool) this.facade.selectTool(state.tool);
    if (state.view) this.facade.setViewMode(state.view);
  }

  protected create(request: NewMapRequest): void {
    void this.facade.createBlankMap(request.settings, request.name);
  }

  protected importSketch(event: Event, dialog: SketchImportDialog): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void dialog.open(file);
  }

  protected createFromSketch(request: SketchMapRequest): void {
    void this.facade.createMapFromSketch(request);
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

  protected duplicate(): void {
    const id = this.facade.currentMapId();
    if (id) void this.facade.duplicateMap(id);
  }

  protected remove(): void {
    const id = this.facade.currentMapId();
    if (id && confirm(`Supprimer définitivement « ${this.facade.mapName()} » ?`)) void this.facade.deleteMap(id);
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
      const selected = this.facade.selectedFeatureId();
      if (selected && event.key === 'Escape') {
        this.facade.selectFeature(null);
        return;
      }
      if (selected && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        this.facade.removeFeature(selected);
        return;
      }
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
