import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EditorFacade } from '../../application/editor-facade';
import { DrawingWarning } from '../../domain/drawing/drawing-checks';
import { drawToolDef } from './draw-tools';
import { LatitudePanel } from '../latitude-panel/latitude-panel';
import { NamesPanel } from '../names-panel/names-panel';
import { VolcanoKind } from '../../domain/drawing/drawn-volcano';

const FOREST_NAME = { broadleaf: 'Feuillus', conifer: 'Résineux', tropical: 'Forêt tropicale' } as const;

function warningText(warning: DrawingWarning, cellKm: number): string {
  switch (warning.kind) {
    case 'noLand':
      return 'Aucune terre pour l’instant : commence avec l’outil Terre (touche T) et peins un continent.';
    case 'riverEndsInland':
      return warning.count === 1
        ? 'Un fleuve s’arrête dans les terres : prolonge-le jusqu’à la mer, un lac ou un autre fleuve.'
        : `${warning.count} fleuves s’arrêtent dans les terres : prolonge-les jusqu’à la mer, un lac ou un autre fleuve.`;
    case 'forestTooCold':
    case 'forestTooWarm': {
      const name = FOREST_NAME[warning.forest];
      const where = `vers ${Math.round(Math.abs(warning.latitudeDeg))}° ${warning.latitudeDeg >= 0 ? 'N' : 'S'}`;
      const why = warning.kind === 'forestTooCold' ? 'trop froid pour ces arbres' : 'trop chaud en plaine pour ces arbres';
      return `${name} ${where} : ${why} (~${formatArea(warning.cells * cellKm * cellKm)}).`;
    }
  }
}

function formatArea(km2: number): string {
  return `${Math.max(1, Math.round(km2)).toLocaleString('fr-FR')} km²`;
}

/** Right panel of the Draw step: what the current tool does, warnings, shortcuts. */
@Component({
  selector: 'cc-draw-help',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LatitudePanel, NamesPanel],
  template: `
    <section class="card">
      <h2>Outil</h2>
      <p class="name">{{ tool().label }}</p>
      <p>{{ tool().description }}</p>
      @if (tool().hint) {
        <p class="hint">{{ tool().hint }}</p>
      }
    </section>
    @if (facade.drawTool() === 'volcano') {
      <section class="card">
        <h2>Type de volcan</h2>
        <div class="kinds" role="radiogroup" aria-label="Type de volcan">
          @for (kind of volcanoKinds; track kind.id) {
            <button type="button" role="radio" class="kind" [attr.aria-checked]="facade.volcanoKind() === kind.id" (click)="facade.setVolcanoKind(kind.id)">
              <b>{{ kind.label }}</b>
              <span>{{ kind.description }}</span>
            </button>
          }
        </div>
        <p class="hint">Clique sur un volcan déjà posé pour lui donner ce type.</p>
      </section>
    }
    @if (facade.drawTool() === 'names') {
      <section class="card">
        <h2>Nouveau nom</h2>
        <cc-names-panel />
      </section>
    }
    <section class="card">
      <h2>À vérifier</h2>
      <ul>
        @for (warning of warnings(); track $index) {
          <li>{{ text(warning) }}</li>
        } @empty {
          <li class="ok">Rien à signaler.</li>
        }
      </ul>
    </section>
    <cc-latitude-panel class="card" title="La couleur du sol suit la latitude : ocre vers les déserts (20–30°), vert à l’équateur et aux latitudes moyennes, pâle là où l’été est froid (grand nord, haute montagne)." />
    <section class="card">
      <h2>Raccourcis</h2>
      <dl>
        <dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>taille du pinceau</dd>
        <dt><kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>annuler</dd>
        <dt>molette</dt><dd>zoomer</dd>
        <dt>clic droit</dt><dd>déplacer la carte</dd>
      </dl>
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; }
    .card { padding: 12px; background: var(--cc-panel); border: var(--cc-border) solid var(--cc-ink); border-radius: var(--cc-radius-soft); }
    h2 { margin: 0 0 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--cc-muted); }
    p { margin: 0 0 6px; line-height: 1.45; }
    .name { font-family: var(--cc-font-map); font-size: 20px; }
    .hint { font-size: 12px; color: var(--cc-muted); }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    li { padding: 6px 8px; font-size: 13px; line-height: 1.35; background: var(--cc-warn-bg); border-left: 4px solid var(--cc-danger); border-radius: 0 6px 6px 0; }
    li.ok { background: var(--cc-ok-bg); border-color: var(--cc-active); }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0; font-size: 12.5px; }
    dt { white-space: nowrap; }
    dd { margin: 0; }
    .kinds { display: grid; gap: 6px; margin-bottom: 6px; }
    .kind {
      display: grid; gap: 1px; padding: 6px 8px; text-align: left; font: inherit; color: var(--cc-ink); cursor: pointer;
      background: var(--cc-panel); border: 1.5px solid var(--cc-line); border-radius: 6px;
    }
    .kind span { font-size: 12px; color: var(--cc-muted); }
    .kind:hover { border-color: var(--cc-ink); }
    .kind[aria-checked='true'] { background: var(--cc-active); color: var(--cc-active-fg); border-color: var(--cc-ink); }
    .kind[aria-checked='true'] span { color: inherit; opacity: 0.85; }
    kbd { font: 600 11px var(--cc-font-ui); padding: 1px 5px; background: var(--cc-panel-2); border: 1px solid var(--cc-line); border-radius: 4px; }
  `,
})
export class DrawHelp {
  protected readonly facade = inject(EditorFacade);
  protected readonly tool = computed(() => drawToolDef(this.facade.drawTool()));
  protected readonly warnings = this.facade.drawingWarnings;
  protected readonly volcanoKinds: readonly { id: VolcanoKind; label: string; description: string }[] = [
    { id: 'erupting', label: 'En éruption', description: 'Cratère rouge, coulées de lave, fumée.' },
    { id: 'smoking', label: 'Endormi', description: 'Cratère sombre, un filet de fumée.' },
    { id: 'shield', label: 'Bouclier', description: 'Large et bas, cratère rouge.' },
  ];

  protected text(warning: DrawingWarning): string {
    return warningText(warning, this.facade.settings()?.baseCellKm ?? 1);
  }
}
