import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ClimateStatus } from '../../application/climate';
import { EditorFacade, ViewMode } from '../../application/editor-facade';
import {
  temperatureLegendGradient,
  TEMPERATURE_PALETTE_MAX_C,
  TEMPERATURE_PALETTE_MIN_C,
} from '../../rendering/style/temperature-palette';
import { Icon, IconName } from '../icon/icon';
import { formatLatitude } from '../../domain/map/latitude';

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const VIEWS: readonly { id: ViewMode; icon: IconName; label: string; title: string }[] = [
  { id: 'relief', icon: 'relief', label: 'Relief', title: 'Couleurs d’altitude (édition)' },
  { id: 'temperature', icon: 'climate', label: 'Temp.', title: 'Températures à la saison choisie' },
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
  imports: [DecimalPipe, Icon],
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

    <section class="lat cc-panel" aria-label="Latitudes">
      <div class="lat-head">
        <span class="slider-head"><cc-icon name="compass" [size]="13" [strokeWidth]="2.4" /> Latitudes</span>
        <button
          type="button"
          class="cc-btn shape-galet ruler-btn"
          [attr.aria-pressed]="!!facade.latitudePins()"
          title="Afficher l’échelle graduée et placer deux repères sur la carte"
          (click)="toggleRuler()"
        >
          <span class="cc-caption">{{ facade.latitudePins() ? 'Fermer' : 'Régler' }}</span>
        </button>
      </div>
      @if (facade.latitudePins(); as pins) {
        <p class="hint">Glisse les deux lignes sur la carte, puis donne leur latitude (négatif = sud).</p>
        @for (pin of pins; track $index) {
          <label class="pin-row">
            <span class="pin-tag">Repère {{ $index + 1 }}</span>
            <input
              class="cc-input"
              type="number"
              step="0.1"
              min="-90"
              max="90"
              [value]="pin.latitudeDeg"
              (change)="setPin($index, $event)"
            />
            <span>°</span>
          </label>
        }
      } @else if (latitudes(); as lat) {
        <p class="lat-range">{{ lat.top }} <span class="muted">en haut</span> → {{ lat.bottom }} <span class="muted">en bas</span></p>
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
    .views .cc-btn { height: 56px; flex-direction: column; gap: 5px; }
    .lat { padding: 10px; display: flex; flex-direction: column; gap: 6px; font-size: 11px; font-weight: 600; }
    .lat-head { display: flex; align-items: center; justify-content: space-between; }
    .ruler-btn { height: 24px; padding: 0 10px; --cc-shadow: 2px; }
    .hint { margin: 0; font-size: 11px; font-weight: 500; color: var(--cc-muted); }
    .pin-row { display: flex; align-items: center; gap: 6px; }
    .pin-tag { flex: 1; }
    .pin-row .cc-input { width: 64px; }
    .lat-range { margin: 0; }
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
  protected readonly minC = TEMPERATURE_PALETTE_MIN_C;
  protected readonly maxC = TEMPERATURE_PALETTE_MAX_C;
  protected readonly monthName = computed(() => MONTH_NAMES[monthOf(this.facade.yearPhase())]);
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.facade.climateStatus()]);

  protected readonly latitudes = computed(() => {
    const s = this.facade.settings();
    return s ? { top: formatLatitude(s.latitudeTopDeg, 1), bottom: formatLatitude(s.latitudeBottomDeg, 1) } : null;
  });

  protected toggleRuler(): void {
    if (this.facade.latitudePins()) this.facade.stopLatitudeEditing();
    else this.facade.startLatitudeEditing();
  }

  protected setPin(index: number, event: Event): void {
    if (index === 0 || index === 1) this.facade.setLatitudePinValue(index, this.numberValue(event));
  }

  protected numberValue(event: Event): number {
    return event.target instanceof HTMLInputElement ? event.target.valueAsNumber : 0;
  }
}
