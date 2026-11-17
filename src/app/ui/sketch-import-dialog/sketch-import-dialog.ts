import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { EditorFacade, SketchMapRequest } from '../../application/editor-facade';
import { DEFAULT_MAP_SETTINGS, gridSizeCells, MapSettings, validateMapSettings } from '../../domain/map/map-settings';
import { SketchImage, SketchMode, SketchPoint } from '../../domain/terrain/sketch';

/** Drawings are processed at this size at most (longest side, px): plenty for a 1–2 km grid. */
const WORK_MAX_PX = 1600;

type Step = 'sea' | 'land' | 'ready';

const MODE_LABELS: Record<SketchMode, string> = {
  colour: 'Carte en couleur : chaque pixel va vers la couleur la plus proche (mer ou terre).',
  lineart: 'Dessin au trait : la mer est remplie depuis votre clic, le trait de côte l’arrête.',
};

/**
 * Import a drawn map: the user clicks a sea point then a land point on the
 * image, sees the detected sea, sets the size in km, and gets a new map
 * whose relief is a first draft (to retouch with the brushes).
 */
@Component({
  selector: 'cc-sketch-import-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog aria-labelledby="sketch-title">
      <form method="dialog" (submit)="submit($event)">
        <h2 id="sketch-title">Carte depuis un dessin</h2>
        <p class="step" role="status">
          @switch (step()) {
            @case ('sea') { <strong>1.</strong> Cliquez sur la <strong>mer</strong>. }
            @case ('land') { <strong>2.</strong> Cliquez sur la <strong>terre</strong>. }
            @case ('ready') { {{ modeLabel() }} }
          }
        </p>
        <div class="body">
          <div class="preview">
            <canvas #preview (click)="onClick($event)" [attr.aria-label]="'Aperçu du dessin'"></canvas>
          </div>
          <div class="side">
            <label class="field"><span>Nom</span><input [value]="name()" (input)="name.set(text($event))" required /></label>
            <label class="field">
              <span>Largeur</span>
              <input type="number" step="10" [value]="settings().widthKm" (input)="setWidth($event)" /><small>km</small>
            </label>
            <p class="derived">Hauteur : {{ settings().heightKm }} km (proportions de l’image)</p>
            <label class="field">
              <span>Résolution</span>
              <input type="number" step="0.25" [value]="settings().baseCellKm" (input)="setField('baseCellKm', $event)" /><small>km</small>
            </label>
            <label class="field">
              <span>Latitude haut</span>
              <input type="number" step="1" [value]="settings().latitudeTopDeg" (input)="setField('latitudeTopDeg', $event)" /><small>°</small>
            </label>
            <label class="field">
              <span>Latitude bas</span>
              <input type="number" step="1" [value]="settings().latitudeBottomDeg" (input)="setField('latitudeBottomDeg', $event)" /><small>°</small>
            </label>
            <p class="derived">Grille : {{ grid() }}</p>
            <p class="note">Le relief est une ébauche inventée : côtes basses, montagnes là où le dessin est chargé d’encre. Retouchez-le ensuite.</p>
            @if (errors().length > 0) {
              <ul class="errors" role="alert">
                @for (error of errors(); track error) {
                  <li>{{ error }}</li>
                }
              </ul>
            }
          </div>
        </div>
        <div class="actions">
          <button type="button" class="cc-btn cc-btn--text shape-tampon" [disabled]="step() === 'sea'" (click)="restart()">Recommencer</button>
          <span class="spacer"></span>
          <button type="button" class="cc-btn cc-btn--text shape-tampon" (click)="close()">Annuler</button>
          <button type="submit" class="cc-btn cc-btn--primary shape-tampon" [disabled]="!canCreate()">Créer</button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    dialog { padding: 18px 20px; background: var(--cc-panel); color: var(--cc-ink); border: var(--cc-border-strong) solid var(--cc-ink); box-shadow: 5px 5px 0 var(--cc-ink); max-width: min(980px, 95vw); }
    dialog::backdrop { background: rgb(31 26 19 / 0.45); }
    h2 { font-family: var(--cc-font-map); font-weight: normal; font-size: 24px; margin: 0 0 4px; }
    .step { margin: 0 0 10px; min-height: 1.4em; }
    .body { display: flex; gap: 16px; align-items: flex-start; }
    .preview { flex: 1; min-width: 0; border: var(--cc-border) solid var(--cc-ink); background: var(--cc-bg); line-height: 0; }
    canvas { max-width: 100%; max-height: 62vh; cursor: crosshair; }
    .side { width: 17rem; flex: none; }
    .field { display: grid; grid-template-columns: 6.5rem 1fr auto; gap: 0.5rem; align-items: center; margin: 0.3rem 0; font-weight: 500; }
    .field input { font: inherit; min-width: 0; padding: 0.2rem 0.4rem; background: var(--cc-bg); color: inherit; border: var(--cc-border) solid var(--cc-ink); }
    .field input:focus-visible { outline: 2px solid var(--cc-accent); outline-offset: 1px; }
    .derived { margin: 0.2rem 0 0.5rem; font-weight: 700; font-size: 0.92em; }
    .note { color: var(--cc-muted); font-style: italic; font-size: 0.9em; }
    .errors { color: var(--cc-danger); font-weight: 700; }
    .actions { display: flex; gap: 0.75rem; margin-top: 12px; }
    .spacer { flex: 1; }
  `,
})
export class SketchImportDialog {
  private readonly facade = inject(EditorFacade);
  readonly create = output<SketchMapRequest>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly preview = viewChild.required<ElementRef<HTMLCanvasElement>>('preview');

  protected readonly name = signal('');
  protected readonly step = signal<Step>('sea');
  private readonly mode = signal<SketchMode | null>(null);
  protected readonly modeLabel = computed(() => {
    const mode = this.mode();
    return mode ? MODE_LABELS[mode] : '';
  });
  private readonly aspect = signal(1); // height / width of the image
  protected readonly settings = signal<MapSettings>(DEFAULT_MAP_SETTINGS);
  protected readonly errors = computed(() => validateMapSettings(this.settings()));
  protected readonly grid = computed(() => {
    if (this.errors().length > 0) return '–';
    const g = gridSizeCells(this.settings());
    return `${g.widthCells} × ${g.heightCells} cellules`;
  });
  protected readonly canCreate = computed(() => this.step() === 'ready' && this.errors().length === 0 && this.name().trim() !== '');

  private image: SketchImage | null = null;
  private bitmap: ImageBitmap | null = null;
  private sea: SketchPoint | null = null;
  private land: SketchPoint | null = null;
  private mask: Uint8Array | null = null;

  async open(file: File): Promise<void> {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      alert('Image illisible : choisissez un fichier PNG, JPEG ou WebP.');
      return;
    }
    const scale = Math.min(1, WORK_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const work = new OffscreenCanvas(width, height);
    const ctx = work.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(bitmap, 0, 0, width, height);
    this.image = { rgba: ctx.getImageData(0, 0, width, height).data, width, height };
    this.bitmap?.close();
    this.bitmap = bitmap;

    this.name.set(file.name.replace(/\.[^.]+$/, '') || 'Carte dessinée');
    this.aspect.set(height / width);
    this.settings.set({ ...DEFAULT_MAP_SETTINGS, seed: crypto.getRandomValues(new Uint32Array(1))[0] });
    this.applyWidth(DEFAULT_MAP_SETTINGS.widthKm);
    const canvas = this.preview().nativeElement;
    canvas.width = width;
    canvas.height = height;
    this.restart();
    this.dialog().nativeElement.showModal();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected restart(): void {
    this.sea = null;
    this.land = null;
    this.mask = null;
    this.mode.set(null);
    this.step.set('sea');
    this.redraw();
  }

  protected onClick(event: MouseEvent): void {
    if (!this.image) return;
    const canvas = this.preview().nativeElement;
    const point = {
      x: Math.min(this.image.width - 1, Math.max(0, (event.offsetX * canvas.width) / canvas.clientWidth)),
      y: Math.min(this.image.height - 1, Math.max(0, (event.offsetY * canvas.height) / canvas.clientHeight)),
    };
    if (this.step() === 'sea') {
      this.sea = point;
      this.step.set('land');
    } else {
      this.land = point;
      if (this.sea) {
        const preview = this.facade.previewSketch(this.image, this.sea, point);
        this.mask = preview.mask;
        this.mode.set(preview.mode);
      }
      this.step.set('ready');
    }
    this.redraw();
  }

  /** The drawing, the detected sea tinted blue, and the two clicked points. */
  private redraw(): void {
    const canvas = this.preview().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || !this.bitmap || !this.image) return;
    ctx.drawImage(this.bitmap, 0, 0, canvas.width, canvas.height);
    if (this.mask) {
      const overlay = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = overlay.data;
      for (let i = 0; i < this.mask.length; i++) {
        if (this.mask[i] !== 1) continue;
        const o = i * 4;
        d[o] = d[o] * 0.45 + 30 * 0.55;
        d[o + 1] = d[o + 1] * 0.45 + 100 * 0.55;
        d[o + 2] = d[o + 2] * 0.45 + 170 * 0.55;
      }
      ctx.putImageData(overlay, 0, 0);
    }
    const radius = Math.max(4, canvas.width / 120);
    const marker = (p: SketchPoint | null, colour: string) => {
      if (!p) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.lineWidth = radius / 2.5;
      ctx.strokeStyle = '#1f1a13';
      ctx.stroke();
    };
    marker(this.sea, '#2f6db0');
    marker(this.land, '#e0a43a');
  }

  protected setWidth(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.applyWidth(event.target.valueAsNumber);
  }

  private applyWidth(widthKm: number): void {
    const w = Number.isNaN(widthKm) ? NaN : widthKm;
    this.settings.update((s) => ({ ...s, widthKm: w, heightKm: Math.round(w * this.aspect()) }));
  }

  protected setField(key: 'baseCellKm' | 'latitudeTopDeg' | 'latitudeBottomDeg', event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const value = event.target.valueAsNumber;
    this.settings.update((s) => ({ ...s, [key]: value }));
  }

  protected text(event: Event): string {
    return event.target instanceof HTMLInputElement ? event.target.value : '';
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.canCreate() || !this.image || !this.sea || !this.land) return;
    this.create.emit({ name: this.name().trim(), settings: this.settings(), image: this.image, sea: this.sea, land: this.land });
    this.close();
  }
}
