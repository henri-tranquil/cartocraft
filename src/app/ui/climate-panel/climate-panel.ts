import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ClimateStatus } from '../../application/climate';
import { EditorFacade, ViewMode } from '../../application/editor-facade';
import { BeyondEdge, BeyondEdges } from '../../domain/map/map-settings';
import {
  temperatureLegendGradient,
  TEMPERATURE_PALETTE_MAX_C,
  TEMPERATURE_PALETTE_MIN_C,
} from '../../rendering/style/temperature-palette';
import { Icon, IconName } from '../icon/icon';
import { LatitudePanel } from '../latitude-panel/latitude-panel';
import { precipitationLegendGradient } from '../../rendering/style/climate-palettes';

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const VIEWS: readonly { id: ViewMode; icon: IconName; label: string; title: string }[] = [
  { id: 'relief', icon: 'relief', label: 'Relief', title: 'Couleurs d’altitude (édition)' },
  { id: 'landscape', icon: 'tree', label: 'Paysage', title: 'Couleurs du climat : végétation, sécheresse, neige, banquise' },
  { id: 'temperature', icon: 'climate', label: 'Temp.', title: 'Températures à la saison choisie' },
  { id: 'precipitation', icon: 'water', label: 'Pluie', title: 'Précipitations du mois (pluie ou neige), mm/mois' },
  { id: 'wind', icon: 'wind', label: 'Vents', title: 'Vents dominants à la saison choisie (les flèches vont où va l’air)' },
];

const STATUS_LABELS: Record<ClimateStatus, string> = {
  idle: 'Pas encore calculé',
  stale: 'À recalculer…',
  computing: 'Calcul en cours…',
  ready: 'À jour',
  error: 'Échec du calcul',
};

/** Year phase → day of year → month (approximation: 365 days). */
function monthOf(phase: number): number {
  return Math.min(11, Math.floor(phase * 12));
}

@Component({
  selector: 'cc-climate-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Icon, LatitudePanel],
  template: `
    <div class="views" role="radiogroup" aria-label="Vue de la carte">
      @for (view of views; track view.id) {
        <button
          type="button"
          role="radio"
          class="cc-btn shape-galet"
          [attr.aria-checked]="facade.viewMode() === view.id"
          [title]="view.title"
          (click)="facade.setViewMode(view.id)"
        >
          <cc-icon [name]="view.icon" [size]="20" [strokeWidth]="1.9" />
          <span class="cc-caption">{{ view.label }}</span>
        </button>
      }
    </div>

    <cc-latitude-panel class="cc-panel" aria-label="Latitudes" />

    <section class="edges cc-panel" aria-label="Au-delà des bords">
      <span class="slider-head" title="Le climat tient compte de ce qui entoure la carte, sur environ 800 km : un continent refroidit les hivers et chauffe les étés, un océan les adoucit.">
        <cc-icon name="wind" [size]="13" [strokeWidth]="2.4" /> Au-delà des bords
      </span>
      @if (facade.settings()?.beyondEdges; as edges) {
        <div class="edge-cross">
          @for (side of edgeSides; track side.key) {
            <select
              class="cc-input"
              [style.grid-area]="side.key"
              [class.edge-ns]="side.key === 'north' || side.key === 'south'"
              [attr.aria-label]="side.label"
              [title]="side.label"
              [value]="edges[side.key]"
              (change)="setEdge(side.key, $event)"
            >
              @for (option of edgeOptions; track option.value) {
                <option [value]="option.value" [selected]="edges[side.key] === option.value">{{ side.short }} · {{ option.label }}</option>
              }
            </select>
          }
          <span class="edge-map" aria-hidden="true">carte</span>
        </div>
      }
    </section>

    <div class="season cc-panel">
      <label class="slider">
        <span class="slider-head"><cc-icon name="climate" [size]="13" [strokeWidth]="2.4" /> Saison <output>{{ monthName() }}</output></span>
        <input
          type="range"
          aria-label="Moment de l’année"
          min="0"
          max="0.999"
          step="0.0025"
          [value]="facade.yearPhase()"
          (input)="facade.setYearPhase(numberValue($event))"
        />
      </label>
      <div class="months" aria-hidden="true"><span>jan</span><span>avr</span><span>juil</span><span>oct</span></div>
    </div>

    @if (facade.viewMode() === 'temperature') {
      <div class="legend">
        <span class="bar" [style.background]="legendGradient"></span>
        <div class="ticks"><span>{{ minC }}°</span><span>0°</span><span>+{{ maxC }}°</span></div>
      </div>
    } @else if (facade.viewMode() === 'precipitation') {
      <div class="legend">
        <span class="bar" [style.background]="precipitationGradient"></span>
        <div class="ticks"><span>0</span><span>100</span><span>250</span><span>500 mm</span></div>
      </div>
    } @else if (facade.viewMode() === 'landscape') {
      <p class="hint">Ocre = sec, vert = humide, brun = végétation en repos, blanc = neige ou banquise. Fais glisser la saison.</p>
    } @else if (facade.viewMode() === 'wind') {
      <p class="hint">Les flèches vont là où va l’air ; ○ = zone de calme. Fais glisser la saison : les ceintures de vents suivent le soleil.</p>
    }

    <p class="status" role="status">
      <span class="dot" [class]="'dot dot--' + facade.climateStatus()"></span>
      {{ statusLabel() }}
      @if (facade.climateStatus() === 'ready' && facade.climateDurationMs(); as ms) {
        <span class="muted">({{ ms / 1000 | number: '1.1-1' }} s)</span>
      }
    </p>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    .views { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .views .cc-btn { height: 50px; flex-direction: column; gap: 4px; }
    .hint { margin: 0; font-size: 11px; font-weight: 500; color: var(--cc-muted); }
    .edges { padding: 10px; display: flex; flex-direction: column; gap: 6px; font-size: 11px; font-weight: 600; }
    .edge-cross {
      display: grid; gap: 4px; align-items: center;
      grid-template-columns: 1fr 44px 1fr;
      grid-template-areas: '. north .' 'west map east' '. south .';
    }
    .edge-cross select { font-size: 10px; padding: 2px; min-width: 0; }
    .edge-cross .edge-ns { grid-column: 1 / -1; justify-self: center; width: 60%; }
    .edge-map {
      grid-area: map; height: 30px; display: grid; place-items: center; font-size: 9px;
      border: var(--cc-border) solid var(--cc-ink); background: var(--cc-bg); color: var(--cc-muted);
    }
    .season { padding: 10px; display: flex; flex-direction: column; gap: 4px; }
    .slider { display: flex; flex-direction: column; gap: 2px; font-size: 11px; font-weight: 600; }
    .slider-head { display: flex; align-items: center; gap: 5px; }
    .slider output { margin-left: auto; }
    .slider input { width: 100%; margin: 0; }
    .months { display: flex; justify-content: space-between; font-size: 10px; color: var(--cc-muted); }
    .legend { display: flex; flex-direction: column; gap: 3px; }
    .bar { height: 10px; border: var(--cc-border) solid var(--cc-ink); }
    .ticks { display: flex; justify-content: space-between; font-size: 10px; font-weight: 600; }
    .status { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 11px; font-weight: 600; }
    .muted { color: var(--cc-muted); font-weight: 500; }
    .dot { width: 10px; height: 10px; border-radius: 50%; border: var(--cc-border) solid var(--cc-ink); background: var(--cc-panel); }
    .dot--ready { background: var(--cc-ok); }
    .dot--stale, .dot--computing { background: var(--cc-accent); }
    .dot--computing { animation: pulse 0.8s ease-in-out infinite alternate; }
    .dot--error { background: var(--cc-danger); }
    @keyframes pulse { to { transform: scale(0.6); } }
    @media (prefers-reduced-motion: reduce) { .dot--computing { animation: none; } }
  `,
})
export class ClimatePanel {
  protected readonly facade = inject(EditorFacade);
  protected readonly views = VIEWS;
  protected readonly legendGradient = temperatureLegendGradient();
  protected readonly precipitationGradient = precipitationLegendGradient();
  protected readonly minC = TEMPERATURE_PALETTE_MIN_C;
  protected readonly maxC = TEMPERATURE_PALETTE_MAX_C;
  protected readonly monthName = computed(() => MONTH_NAMES[monthOf(this.facade.yearPhase())]);
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.facade.climateStatus()]);

  protected readonly edgeSides: { key: keyof BeyondEdges; short: string; label: string }[] = [
    { key: 'north', short: 'N', label: 'Au nord de la carte' },
    { key: 'west', short: 'O', label: 'À l’ouest de la carte' },
    { key: 'east', short: 'E', label: 'À l’est de la carte' },
    { key: 'south', short: 'S', label: 'Au sud de la carte' },
  ];
  protected readonly edgeOptions: { value: BeyondEdge; label: string }[] = [
    { value: 'continue', label: 'Prolonger' },
    { value: 'ocean', label: 'Océan' },
    { value: 'land', label: 'Continent' },
  ];

  protected setEdge(side: keyof BeyondEdges, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const option = this.edgeOptions.find((o) => o.value === value);
    if (option) this.facade.setBeyondEdge(side, option.value);
  }

  protected numberValue(event: Event): number {
    return event.target instanceof HTMLInputElement ? event.target.valueAsNumber : 0;
  }
}
