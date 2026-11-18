import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EditorFacade } from '../../application/editor-facade';
import { Icon } from '../icon/icon';
import { DRAW_GROUPS, PAN_TOOL } from './draw-tools';

/** Left palette of the Draw step: tool groups in the recommended drawing order. */
@Component({
  selector: 'cc-draw-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (!facade.layerEditable()) {
      <p class="lock-note">Carte <b>Monde</b> : le dessin est déduit de l’altitude, en lecture seule. Modifie le relief dans l’étape 2 ; seuls les latitudes et les noms se règlent ici.</p>
    }
    <button
      type="button"
      class="tool pan"
      [attr.aria-pressed]="facade.drawTool() === 'pan'"
      [title]="pan.label + ' (' + pan.key + ')'"
      (click)="facade.selectDrawTool('pan')"
    >
      <cc-icon [name]="pan.icon" [size]="18" [strokeWidth]="2" />
      <span>{{ pan.label }}</span>
      <kbd>{{ pan.key }}</kbd>
    </button>
    @for (group of groups; track group.step) {
      <section class="group" [attr.aria-label]="group.title">
        <h3>
          <b>{{ group.step }}</b> {{ group.title }}
          @if (group.soon) {
            <span class="soon">{{ group.soon }}</span>
          }
        </h3>
        <div class="tools">
          @for (tool of group.tools; track tool.label) {
            <button
              type="button"
              class="tool"
              [disabled]="!tool.id || !facade.layerEditable()"
              [attr.aria-pressed]="tool.id !== null && facade.drawTool() === tool.id"
              [title]="tool.label + (tool.key ? ' (' + tool.key + ')' : '') + ' — ' + tool.description"
              (click)="tool.id && facade.selectDrawTool(tool.id)"
            >
              <cc-icon [name]="tool.icon" [size]="20" [strokeWidth]="1.8" />
              <span>{{ tool.label }}</span>
              @if (tool.key) {
                <kbd>{{ tool.key }}</kbd>
              }
            </button>
          }
        </div>
      </section>
    }
    <p class="note">Ordre conseillé : la côte, puis le relief, les forêts et les fleuves. Rien n’est figé : tout se repeint.</p>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    h3 { display: flex; align-items: baseline; gap: 6px; margin: 0 0 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--cc-muted); }
    h3 b { color: var(--cc-ink); font-size: 12px; }
    .soon { margin-left: auto; font-weight: 600; text-transform: none; letter-spacing: 0; font-style: italic; }
    .tools { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .tool {
      position: relative; display: grid; grid-template-columns: 22px 1fr; align-items: center; gap: 6px; min-height: 40px; padding: 5px 6px;
      text-align: left; font: inherit; font-size: 12.5px; line-height: 1.15; color: var(--cc-ink); cursor: pointer;
      background: var(--cc-panel); border: 1.5px solid var(--cc-line); border-radius: 6px;
    }
    .tool:hover:not(:disabled) { border-color: var(--cc-ink); }
    .tool[aria-pressed='true'] { background: var(--cc-active); color: var(--cc-active-fg); border-color: var(--cc-ink); box-shadow: inset 0 0 0 1px var(--cc-ink); }
    .tool:disabled { opacity: 0.45; cursor: not-allowed; }
    .tool:focus-visible { outline: 3px solid var(--cc-accent); outline-offset: 1px; }
    .pan { grid-template-columns: 22px 1fr auto; }
    kbd { position: absolute; top: 3px; right: 5px; font: 600 9px var(--cc-font-ui); opacity: 0.6; }
    .pan kbd { position: static; }
    .note { margin: 0; font-size: 12px; line-height: 1.4; color: var(--cc-muted); }
    .lock-note { margin: 0; padding: 6px 8px; font-size: 12px; line-height: 1.4; background: var(--cc-warn-bg); border-left: 4px solid var(--cc-accent); border-radius: 0 6px 6px 0; }
  `,
})
export class DrawPalette {
  protected readonly facade = inject(EditorFacade);
  protected readonly groups = DRAW_GROUPS;
  protected readonly pan = PAN_TOOL;
}
