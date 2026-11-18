import { ChangeDetectionStrategy, Component, computed, effect, HostListener, inject, OnInit, signal } from '@angular/core';
import { EditorFacade, SketchMapRequest } from '../../application/editor-facade';
import { SaveStatus } from '../../application/auto-save';
import { ClimatePanel } from '../climate-panel/climate-panel';
import { NamesPanel } from '../names-panel/names-panel';
import { Icon, IconName } from '../icon/icon';
import { MapCanvas } from '../map-canvas/map-canvas';
import { MapsMenu } from '../maps-menu/maps-menu';
import { BrushBar } from '../draw-palette/brush-bar';
import { DrawHelp } from '../draw-palette/draw-help';
import { DrawPalette } from '../draw-palette/draw-palette';
import { drawToolForKey } from '../draw-palette/draw-tools';
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
  { id: 'water', icon: 'water', short: 'Eaux', label: 'Eaux : fleuves calculés depuis le relief et les pluies', available: true },
  { id: 'names', icon: 'names', short: 'Noms', label: 'Noms : villes, sommets, mers, régions', available: true },
  { id: 'render', icon: 'render', short: 'Rendu', label: 'Rendu : la carte illustrée, à l’ancienne', available: true },
];

/** [ and ] change the brush size by this factor (multiplicative: fine when small, fast when large). */
const BRUSH_KEY_STEP = 1.25;

const SAVE_STATUS_LABELS: Record<SaveStatus, string> = {
  idle: '',
  pending: 'Modifications non enregistrées',
  saving: 'Enregistrement…',
  saved: 'Enregistré',
  error: 'Échec de l’enregistrement',
};

/**
 * Layout: top bar (maps menu, name, undo, the two workflow steps), then
 * - step 1 « Dessiner »: tool palette | map with the brush bar | help panel;
 * - step 2 « Monde »: section bar | section panel | map.
 */
@Component({
  selector: 'cc-editor-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrushBar, ClimatePanel, DrawHelp, DrawPalette, Icon, MapCanvas, MapsMenu, NamesPanel, NewMapDialog, SketchImportDialog, ToolPanel],
  host: {
    '(window:keydown)': 'onKeydown($event)',
  },
  template: `
    <header class="top">
      <span class="brand"><cc-icon name="compass" [size]="20" [strokeWidth]="2.2" /> Cartocraft</span>
      <cc-maps-menu (newMap)="newMapDialog.open()" (sketch)="sketchDialog.open($event)" />
      @if (facade.hasMap()) {
        <input
          class="map-name"
          aria-label="Nom de la carte"
          [value]="facade.mapName()"
          (change)="rename($event)"
          (keydown.enter)="blur($event)"
        />
        <span class="spacer"></span>
        <div class="history">
          <button
            type="button"
            class="ghost"
            [title]="'Ctrl+Z' + (facade.undoLabel() ? ' — ' + facade.undoLabel() : '')"
            [disabled]="!facade.undoLabel()"
            (click)="facade.undo()"
          >
            <cc-icon name="undo" [size]="14" [strokeWidth]="2.4" /> Annuler
          </button>
          <button
            type="button"
            class="ghost"
            aria-label="Rétablir"
            [title]="'Rétablir (Ctrl+Y)' + (facade.redoLabel() ? ' — ' + facade.redoLabel() : '')"
            [disabled]="!facade.redoLabel()"
            (click)="facade.redo()"
          >
            <cc-icon name="redo" [size]="14" [strokeWidth]="2.4" />
          </button>
          <span class="save" [class]="'save save--' + facade.saveStatus()" [title]="saveLabel()" role="status" [attr.aria-label]="saveLabel()"></span>
        </div>
        <div class="steps" role="group" aria-label="Étape">
          <button type="button" [attr.aria-pressed]="facade.workspace() === 'draw'" title="Dessiner la carte : terres, relief, forêts, fleuves" (click)="facade.setWorkspace('draw')">
            <b>1</b> Dessiner
          </button>
          <cc-icon name="arrowRight" [size]="14" [strokeWidth]="2.2" />
          <button type="button" [attr.aria-pressed]="facade.workspace() === 'world'" [title]="worldTitle" (click)="facade.setWorkspace('world')">
            <b>2</b> Monde
          </button>
        </div>
      } @else {
        <span class="spacer"></span>
      }
    </header>

    <div class="body">
      @if (facade.hasMap()) {
        @if (facade.workspace() === 'draw') {
          <aside class="palette" aria-label="Outils de dessin"><cc-draw-palette /></aside>
        } @else {
          <nav class="actions" aria-label="Sections">
            @for (section of sections; track section.id) {
              <button
                type="button"
                class="cc-btn shape-tampon act"
                [class.act--apart]="section.id === 'render'"
                [disabled]="!section.available"
                [attr.aria-pressed]="activeSection() === section.id"
                [attr.aria-label]="section.label"
                [title]="section.label"
                (click)="activeSection.set(section.id)"
              >
                <cc-icon [name]="section.icon" [size]="17" [strokeWidth]="2" />
                <span class="cc-caption">{{ section.short }}</span>
              </button>
            }
          </nav>
          <aside class="tools" [attr.aria-label]="activeLabel()">
            <h2 class="heading"><cc-icon [name]="activeIcon()" [size]="14" [strokeWidth]="2.4" /> {{ activeShort() }}</h2>
            @switch (activeSection()) {
              @case ('relief') {
                <cc-tool-panel />
              }
              @case ('climate') {
                <cc-climate-panel />
              }
              @case ('water') {
                <p class="hint">
                  Les fleuves sont calculés à partir du relief et des pluies, en même temps que le climat. Plus on zoome, plus les petits cours d’eau
                  apparaissent ; le débit s’affiche au survol. Pour déplacer un fleuve, creusez une vallée dans Relief : l’eau suivra la pente.
                </p>
              }
              @case ('names') {
                <cc-names-panel />
              }
              @case ('render') {
                <p class="hint">Vue « carte ancienne », en lecture seule : le clic déplace la carte. Les fleuves et les noms y figurent.</p>
              }
            }
            <p class="hint world-note">
              Le monde garde pour l’instant son propre relief : la conversion depuis le dessin arrive bientôt.
            </p>
          </aside>
        }
      }

      <main class="main">
        @if (facade.error(); as error) {
          <div class="error" role="alert">
            <span>{{ error }}</span>
            <button type="button" class="cc-btn shape-sceau dismiss" aria-label="Fermer" (click)="facade.dismissError()">
              <cc-icon name="close" [size]="12" [strokeWidth]="3" />
            </button>
          </div>
        }
        @if (facade.hasMap()) {
          <div class="frame">
            <div class="frame-inner"><cc-map-canvas /></div>
            @if (facade.workspace() === 'draw' && facade.drawTool() !== 'pan') {
              <cc-brush-bar class="brush" />
            }
          </div>
        } @else {
          <div class="empty">
            <p>Aucune carte ouverte.</p>
            <button type="button" class="cc-btn cc-btn--primary shape-tampon" (click)="newMapDialog.open()">
              <cc-icon name="plus" [size]="16" [strokeWidth]="2.6" /> Nouvelle carte
            </button>
          </div>
        }
      </main>

      @if (facade.hasMap() && facade.workspace() === 'draw') {
        <aside class="help" aria-label="Aide"><cc-draw-help /></aside>
      }
    </div>
    <cc-new-map-dialog #newMapDialog (create)="create($event)" />
    <cc-sketch-import-dialog #sketchDialog (create)="createFromSketch($event)" />
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; }

    .top {
      flex: none; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 14px;
      background: var(--cc-side); color: var(--cc-side-fg);
    }
    .brand { display: inline-flex; align-items: center; gap: 8px; font-family: var(--cc-font-map); font-size: 21px; letter-spacing: 0.5px; }
    .brand cc-icon { color: var(--cc-accent); }
    .map-name {
      min-width: 0; width: 260px; padding: 3px 6px; border: 1px dashed transparent; border-radius: 6px; outline: none;
      background: transparent; color: inherit; font-family: var(--cc-font-map); font-size: 18px;
    }
    .map-name:hover { border-color: var(--cc-side-line); }
    .map-name:focus-visible { border-color: var(--cc-accent); }
    .spacer { flex: 1; }
    .history { display: flex; align-items: center; gap: 4px; }
    .ghost {
      display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; cursor: pointer; font: inherit;
      background: transparent; color: var(--cc-side-fg); border: 1px solid var(--cc-side-line); border-radius: var(--cc-radius-soft);
    }
    .ghost:hover:not(:disabled) { border-color: var(--cc-accent); }
    .ghost:disabled { opacity: 0.4; cursor: default; }
    .save { width: 10px; height: 10px; margin-left: 6px; border-radius: 50%; border: 1.5px solid var(--cc-side-fg); }
    .save--saved { background: var(--cc-ok); }
    .save--pending, .save--saving { background: var(--cc-accent); }
    .save--error { background: var(--cc-danger); }
    .steps { display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 999px; background: #3a3226; color: var(--cc-side-fg); }
    .steps button {
      display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; border: 0; border-radius: 999px; cursor: pointer;
      background: transparent; color: inherit; font: inherit; font-weight: 600;
    }
    .steps button b { font-size: 11px; opacity: 0.7; }
    .steps button[aria-pressed='true'] { background: var(--cc-accent); color: var(--cc-ink); }
    .steps cc-icon { opacity: 0.6; }

    .body { flex: 1; min-height: 0; display: flex; gap: 12px; padding: 12px; }
    .palette, .help { flex: none; overflow-y: auto; }
    .palette {
      width: 230px; padding: 12px; background: var(--cc-panel); border: var(--cc-border) solid var(--cc-ink);
      border-radius: var(--cc-radius-soft); box-shadow: 3px 3px 0 var(--cc-ink);
    }
    .help { width: 250px; }

    .actions { width: 64px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 8px; overflow-y: auto; }
    .act { width: 52px; height: 46px; flex: none; flex-direction: column; gap: 3px; --cc-shadow: 2px; }
    .act--apart { margin-top: 10px; }
    .act--apart::before { content: ''; position: absolute; top: -10px; left: 4px; right: 4px; border-top: var(--cc-border) dashed var(--cc-ink); }
    .tools {
      width: 208px; flex: none; display: flex; flex-direction: column; gap: 14px; padding: 14px 12px; overflow: auto;
      background: var(--cc-panel); border: var(--cc-border) solid var(--cc-ink); border-radius: var(--cc-radius-soft);
    }
    .heading { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
    .hint { margin: 0; font-size: 12px; color: var(--cc-muted); line-height: 1.45; }
    .world-note { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--cc-line); }

    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
    .frame {
      flex: 1; min-height: 0; position: relative; background: var(--cc-panel);
      border: var(--cc-border-strong) solid var(--cc-ink); border-radius: var(--cc-radius-soft); overflow: hidden;
    }
    .frame-inner { position: absolute; inset: 0; }
    .brush { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); width: max-content; max-width: calc(100% - 24px); }

    .error {
      display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.4rem 0.6rem;
      background: var(--cc-danger); color: var(--cc-panel); font-weight: 600; border-radius: var(--cc-radius-soft);
    }
    .dismiss { width: 26px; height: 26px; --cc-shadow: 2px; }
    .empty { flex: 1; display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; color: var(--cc-muted); }
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
  protected readonly worldTitle = 'Le monde : relief, climat et saisons, fleuves, noms, rendu illustré';
  private readonly inWorld = computed(() => this.facade.workspace() === 'world');

  /** The URL is written only once the map it names is open (a reload must not erase it first). */
  private readonly started = signal(false);

  constructor() {
    // Address bar ⇄ state: map, section, relief tool, climate view.
    effect(() => {
      if (!this.started()) return;
      const hash = formatUrlState({
        mapId: this.facade.currentMapId() ?? undefined,
        workspace: this.facade.workspace(),
        section: this.activeSection(),
        tool: this.facade.activeTool(),
        view: this.facade.viewMode(),
      });
      if (location.hash !== hash) history.replaceState(history.state, '', hash);
    });
    // World step: only the Relief panel edits the terrain; elsewhere a click just moves the map.
    effect(() => this.facade.setEditingEnabled(this.activeSection() === 'relief'));
    effect(() => this.facade.setRendered(this.inWorld() && this.activeSection() === 'render'));
    effect(() => this.facade.setNamesEditing(this.inWorld() && this.activeSection() === 'names'));
    // The latitude ruler belongs to the Climate panel: leaving it (or the World step) closes the ruler.
    effect(() => {
      if (!this.inWorld() || this.activeSection() !== 'climate') this.facade.stopLatitudeEditing();
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
    if (state.workspace) this.facade.setWorkspace(state.workspace);
    if (state.section && SECTIONS.some((s) => s.id === state.section && s.available)) this.activeSection.set(state.section);
    if (state.tool) this.facade.selectTool(state.tool);
    if (state.view) this.facade.setViewMode(state.view);
  }

  protected create(request: NewMapRequest): void {
    this.facade.setWorkspace('draw'); // a new map starts as an empty sea to draw on
    void this.facade.createBlankMap(request.settings, request.name);
  }

  protected createFromSketch(request: SketchMapRequest): void {
    void this.facade.createMapFromSketch(request);
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
      if (event.altKey || !this.facade.hasMap()) return;
      if (!this.inWorld()) {
        const radiusKm = this.facade.drawingBrush().radiusKm;
        if (event.key === '[') this.facade.setDrawingBrush({ radiusKm: radiusKm / BRUSH_KEY_STEP });
        else if (event.key === ']') this.facade.setDrawingBrush({ radiusKm: radiusKm * BRUSH_KEY_STEP });
        const drawTool = drawToolForKey(event.key);
        if (drawTool) this.facade.selectDrawTool(drawTool);
        return;
      }
      const tool = toolForKey(event.key);
      if (tool) {
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
