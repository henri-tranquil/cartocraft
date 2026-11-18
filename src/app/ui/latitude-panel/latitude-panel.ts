import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { EditorFacade, MAX_TILT_DEG } from '../../application/editor-facade';
import { formatLatitude } from '../../domain/map/latitude';
import { Icon } from '../icon/icon';

/** Latitudes and axial tilt: shown in the Draw step (ground colour) and the Climate section. */
@Component({
  selector: 'cc-latitude-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Icon],
  template: `
    <div class="lat-head">
      <span class="head"><cc-icon name="compass" [size]="13" [strokeWidth]="2.4" /> Latitudes</span>
      <button
        type="button"
        class="cc-btn shape-galet small-btn"
        [attr.aria-pressed]="!!facade.latitudePins()"
        title="Afficher l’échelle graduée et placer deux repères sur la carte"
        (click)="toggleRuler()"
      >
        <span class="cc-caption">{{ facade.latitudePins() ? 'Fermer' : 'Régler' }}</span>
      </button>
    </div>
    @if (facade.latitudePins(); as pins) {
      <p class="hint">Glisse les deux repères sur la carte et donne leur latitude (négatif = sud). Glisse un tropique ou un cercle polaire pour régler l’inclinaison.</p>
      @for (pin of pins; track $index) {
        <label class="pin-row">
          <span class="pin-tag">Repère {{ $index + 1 }}</span>
          <input class="cc-input" type="number" step="0.1" min="-90" max="90" [value]="pin.latitudeDeg" (change)="setPin($index, $event)" />
          <span>°</span>
        </label>
      }
      <label class="pin-row" title="Inclinaison de l’axe : place les tropiques (±inclinaison) et les cercles polaires, et règle l’amplitude des saisons. Terre : 23,4°.">
        <span class="pin-tag">Inclinaison</span>
        <input class="cc-input" type="number" step="0.1" min="0" [max]="maxTilt" [value]="facade.displayedTilt()" (change)="setTilt($event)" />
        <span>°</span>
      </label>
      <div class="presets">
        <button type="button" class="cc-btn shape-galet small-btn" title="Remettre l’inclinaison de la Terre (23,4°)" (click)="facade.updateClimateSettings({ axialTiltDeg: 23.44 })">
          <span class="cc-caption">Terre</span>
        </button>
      </div>
    } @else if (latitudes(); as lat) {
      <p class="lat-range">{{ lat.top }} <span class="muted">en haut</span> → {{ lat.bottom }} <span class="muted">en bas</span></p>
      <p class="lat-range">Inclinaison {{ facade.settings()?.axialTiltDeg | number: '1.1-1' }}°</p>
    }
  `,
  styles: `
    :host { padding: 10px; display: flex; flex-direction: column; gap: 6px; font-size: 11px; font-weight: 600; }
    .lat-head { display: flex; align-items: center; justify-content: space-between; }
    .head { display: flex; align-items: center; gap: 5px; }
    .small-btn { height: 24px; padding: 0 10px; --cc-shadow: 2px; }
    .hint { margin: 0; font-size: 11px; font-weight: 500; color: var(--cc-muted); }
    .pin-row { display: flex; align-items: center; gap: 6px; }
    .pin-tag { flex: 1; }
    .pin-row .cc-input { width: 64px; }
    .lat-range { margin: 0; }
    .presets { display: flex; justify-content: flex-end; }
    .muted { color: var(--cc-muted); font-weight: 500; }
  `,
})
export class LatitudePanel {
  protected readonly facade = inject(EditorFacade);
  protected readonly maxTilt = MAX_TILT_DEG;

  protected readonly latitudes = computed(() => {
    const s = this.facade.settings();
    return s ? { top: formatLatitude(s.latitudeTopDeg, 1), bottom: formatLatitude(s.latitudeBottomDeg, 1) } : null;
  });

  protected toggleRuler(): void {
    if (this.facade.latitudePins()) this.facade.stopLatitudeEditing();
    else this.facade.startLatitudeEditing();
  }

  protected setPin(index: number, event: Event): void {
    if (index === 0 || index === 1) this.facade.setLatitudePinValue(index, valueOf(event));
  }

  protected setTilt(event: Event): void {
    const value = valueOf(event);
    if (Number.isFinite(value)) this.facade.updateClimateSettings({ axialTiltDeg: Math.min(MAX_TILT_DEG, Math.max(0, value)) });
  }
}

function valueOf(event: Event): number {
  return event.target instanceof HTMLInputElement ? event.target.valueAsNumber : Number.NaN;
}
