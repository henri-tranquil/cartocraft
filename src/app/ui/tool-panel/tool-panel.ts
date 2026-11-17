import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BRUSH_LIMITS, EditorFacade, TOOL_LABELS, ToolId } from '../../application/editor-facade';
import { Icon, IconName } from '../icon/icon';

const TOOL_ORDER: readonly ToolId[] = ['pan', 'raise', 'lower', 'smooth'];
const TOOL_KEYS: Record<ToolId, string> = { pan: 'H', raise: 'E', lower: 'A', smooth: 'L' };
const TOOL_ICONS: Record<ToolId, IconName> = { pan: 'pan', raise: 'raise', lower: 'lower', smooth: 'smooth' };
/** Brush preview circle: px per km, clamped so it always fits the box. */
const PREVIEW_PX_PER_KM = 0.5;

@Component({
  selector: 'cc-tool-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="tools" role="radiogroup" aria-label="Outil actif">
      @for (id of tools; track id) {
        <button
          type="button"
          role="radio"
          class="cc-btn shape-tampon"
          [attr.aria-checked]="facade.activeTool() === id"
          [title]="labels[id] + ' — raccourci ' + keys[id]"
          (click)="facade.selectTool(id)"
        >
          <cc-icon [name]="icons[id]" [size]="24" [strokeWidth]="1.8" />
          <span class="cc-caption">{{ labels[id] }}</span>
        </button>
      }
    </div>

    @if (facade.activeTool() !== 'pan') {
      <div class="brush cc-panel">
        <div class="preview" role="img" [attr.aria-label]="'Pinceau de ' + facade.brush().radiusKm + ' km'">
          <span class="circle" [style.width.px]="previewPx()" [style.height.px]="previewPx()"></span>
        </div>
        <label class="slider">
          <span class="slider-head"><cc-icon name="radius" [size]="13" [strokeWidth]="2.6" /> Rayon <output>{{ facade.brush().radiusKm }} km</output></span>
          <input
            type="range"
            aria-label="Rayon (km)"
            [min]="limits.minRadiusKm"
            [max]="limits.maxRadiusKm"
            [value]="facade.brush().radiusKm"
            (input)="facade.setBrush({ radiusKm: numberValue($event) })"
          />
        </label>
        <label class="slider">
          <span class="slider-head"><cc-icon name="strength" [size]="13" [strokeWidth]="2.6" /> Intensité <output>{{ strengthPercent() }} %</output></span>
          <input
            type="range"
            aria-label="Intensité (%)"
            min="1"
            max="100"
            [value]="strengthPercent()"
            (input)="facade.setBrush({ strength: numberValue($event) / 100 })"
          />
        </label>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    .tools { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .tools .cc-btn { height: 60px; flex-direction: column; gap: 5px; }
    .brush { display: flex; flex-direction: column; gap: 8px; padding: 10px; }
    .preview { height: 64px; display: flex; align-items: center; justify-content: center; }
    .circle { border-radius: 50%; border: var(--cc-border) dashed var(--cc-ink); background: radial-gradient(circle, var(--cc-ink) 0 18%, transparent 60%); }
    .slider { display: flex; flex-direction: column; gap: 2px; font-size: 11px; font-weight: 600; }
    .slider-head { display: flex; align-items: center; gap: 5px; }
    .slider output { margin-left: auto; font-variant-numeric: tabular-nums; }
    .slider input { width: 100%; margin: 0; }
  `,
})
export class ToolPanel {
  protected readonly facade = inject(EditorFacade);
  protected readonly tools = TOOL_ORDER;
  protected readonly labels = TOOL_LABELS;
  protected readonly keys = TOOL_KEYS;
  protected readonly icons = TOOL_ICONS;
  protected readonly limits = BRUSH_LIMITS;
  protected readonly strengthPercent = computed(() => Math.round(this.facade.brush().strength * 100));
  protected readonly previewPx = computed(() => Math.max(10, Math.min(58, this.facade.brush().radiusKm * PREVIEW_PX_PER_KM)));

  protected numberValue(event: Event): number {
    return event.target instanceof HTMLInputElement ? event.target.valueAsNumber : 0;
  }
}

/** Keyboard shortcut → tool, used by the editor shell. */
export function toolForKey(key: string): ToolId | null {
  const upper = key.toUpperCase();
  return TOOL_ORDER.find((id) => TOOL_KEYS[id] === upper) ?? null;
}
