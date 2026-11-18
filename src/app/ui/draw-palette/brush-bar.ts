import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DRAWING_BRUSH_LIMITS, EditorFacade } from '../../application/editor-facade';

/** Brush settings of the Draw step, floating over the map. */
@Component({
  selector: 'cc-brush-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label title="Diamètre du pinceau ( [ et ] au clavier)">
      Taille
      <input
        type="range"
        [min]="limits.minRadiusKm"
        [max]="limits.maxRadiusKm"
        [value]="facade.drawingBrush().radiusKm"
        (input)="setRadius($event)"
      />
      <output>{{ diameterKm() }} km</output>
    </label>
    <label title="Bord net, naturel ou découpé">
      Bord
      <input type="range" min="0" max="100" [value]="facade.drawingBrush().roughness * 100" (input)="setRoughness($event)" />
      <output>{{ roughnessLabel() }}</output>
    </label>
  `,
  styles: `
    :host {
      display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 16px; padding: 5px 16px;
      background: var(--cc-panel); border: var(--cc-border) solid var(--cc-ink); border-radius: 999px; box-shadow: 3px 3px 0 var(--cc-ink);
    }
    label { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
    input { width: 110px; accent-color: var(--cc-active); }
    output { min-width: 4.2em; font-weight: 400; color: var(--cc-muted); font-variant-numeric: tabular-nums; }
  `,
})
export class BrushBar {
  protected readonly facade = inject(EditorFacade);
  protected readonly limits = DRAWING_BRUSH_LIMITS;
  protected readonly diameterKm = computed(() => Math.round(this.facade.drawingBrush().radiusKm * 2));
  protected readonly roughnessLabel = computed(() => {
    const r = this.facade.drawingBrush().roughness;
    return r < 0.25 ? 'net' : r < 0.7 ? 'naturel' : 'découpé';
  });

  protected setRadius(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.facade.setDrawingBrush({ radiusKm: Number(event.target.value) });
  }

  protected setRoughness(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.facade.setDrawingBrush({ roughness: Number(event.target.value) / 100 });
  }
}
