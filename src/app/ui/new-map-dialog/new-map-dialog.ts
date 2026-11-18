import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DEFAULT_MAP_SETTINGS, gridSizeCells, MapSettings, validateMapSettings } from '../../domain/map/map-settings';
import { MapSource } from '../../domain/map/world-map';

export interface NewMapRequest {
  readonly name: string;
  readonly settings: MapSettings;
  readonly source: MapSource;
}

type NumericField = keyof MapSettings;

interface FieldDef {
  readonly key: NumericField;
  readonly label: string;
  readonly unit: string;
  readonly step: number;
}

const FIELDS: readonly FieldDef[] = [
  { key: 'widthKm', label: 'Largeur', unit: 'km', step: 10 },
  { key: 'heightKm', label: 'Hauteur', unit: 'km', step: 10 },
  { key: 'baseCellKm', label: 'Résolution', unit: 'km / cellule', step: 0.25 },
  { key: 'latitudeTopDeg', label: 'Latitude du bord haut', unit: '°', step: 1 },
  { key: 'latitudeBottomDeg', label: 'Latitude du bord bas', unit: '°', step: 1 },
  { key: 'axialTiltDeg', label: "Inclinaison de l'axe", unit: '°', step: 0.1 },
  { key: 'seed', label: 'Graine', unit: '', step: 1 },
];

@Component({
  selector: 'cc-new-map-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog aria-labelledby="new-map-title">
      <form method="dialog" (submit)="submit($event)">
        <h2 id="new-map-title">Nouvelle carte</h2>

        <label class="field">
          <span>Nom</span>
          <input [value]="name()" (input)="name.set(textValue($event))" required />
        </label>

        <fieldset class="source">
          <legend>On modifie</legend>
          <label title="Tu dessines terres, relief, forêts et fleuves ; le monde (altitudes) en sera déduit.">
            <input type="radio" name="source" value="drawing" [checked]="source() === 'drawing'" (change)="source.set('drawing')" />
            <span><b>le dessin</b> (le monde en sera déduit)</span>
          </label>
          <label title="Tu sculptes directement les altitudes ; le dessin en sera déduit.">
            <input type="radio" name="source" value="world" [checked]="source() === 'world'" (change)="source.set('world')" />
            <span><b>le monde</b> (altitudes ; le dessin en sera déduit)</span>
          </label>
          <small>Choix définitif pour cette carte.</small>
        </fieldset>

        @for (field of fields; track field.key) {
          <label class="field">
            <span>{{ field.label }}</span>
            <input type="number" [step]="field.step" [value]="settings()[field.key]" (input)="setField(field.key, $event)" />
            <small>{{ field.unit }}</small>
            @if (field.key === 'seed') {
              <button type="button" class="cc-btn shape-sceau" (click)="randomSeed()" aria-label="Graine aléatoire" title="Graine aléatoire">⚄</button>
            }
          </label>
        }

        <p class="summary">Grille : {{ grid().widthCells }} × {{ grid().heightCells }} cellules</p>
        <p class="note">Départ : une mer vide. La génération procédurale viendra plus tard.</p>

        @if (errors().length > 0) {
          <ul class="errors" role="alert">
            @for (error of errors(); track error) {
              <li>{{ error }}</li>
            }
          </ul>
        }

        <div class="actions">
          <button type="button" class="cc-btn cc-btn--text shape-tampon" (click)="close()">Annuler</button>
          <button type="submit" class="cc-btn cc-btn--primary shape-tampon" [disabled]="errors().length > 0 || name().trim() === ''">Créer</button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    dialog { padding: 18px 20px; background: var(--cc-panel); color: var(--cc-ink); border: var(--cc-border-strong) solid var(--cc-ink); box-shadow: 5px 5px 0 var(--cc-ink); min-width: 22rem; }
    dialog::backdrop { background: rgb(31 26 19 / 0.45); }
    h2 { font-family: var(--cc-font-map); font-weight: normal; font-size: 24px; margin: 0 0 8px; }
    .field { display: grid; grid-template-columns: 10rem 6.5rem auto auto; gap: 0.5rem; align-items: center; margin: 0.3rem 0; font-weight: 500; }
    .field input { font: inherit; padding: 0.2rem 0.4rem; background: var(--cc-bg); color: inherit; border: var(--cc-border) solid var(--cc-ink); }
    .field input:focus-visible { outline: 2px solid var(--cc-accent); outline-offset: 1px; }
    .field .cc-btn { width: 28px; height: 28px; --cc-shadow: 2px; }
    .summary { font-weight: 700; }
    .source { display: grid; gap: 4px; margin: 4px 0 8px; padding: 6px 10px; border: var(--cc-border) solid var(--cc-ink); }
    .source legend { font-weight: 700; padding: 0 4px; }
    .source label { display: flex; gap: 6px; align-items: center; }
    .source small { color: var(--cc-muted); }
    .note { color: var(--cc-muted); font-style: italic; font-size: 0.9em; }
    .errors { color: var(--cc-danger); font-weight: 700; }
    .actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 12px; }
  `,
})
export class NewMapDialog {
  readonly create = output<NewMapRequest>();

  protected readonly fields = FIELDS;
  protected readonly name = signal('Nouvelle carte');
  protected readonly settings = signal<MapSettings>(DEFAULT_MAP_SETTINGS);
  protected readonly source = signal<MapSource>('drawing');
  protected readonly errors = computed(() => validateMapSettings(this.settings()));
  protected readonly grid = computed(() =>
    this.errors().length === 0 ? gridSizeCells(this.settings()) : { widthCells: '–', heightCells: '–' },
  );

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  open(): void {
    this.name.set('Nouvelle carte');
    this.settings.set({ ...DEFAULT_MAP_SETTINGS, seed: randomSeed() });
    this.source.set('drawing');
    this.dialog().nativeElement.showModal();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected setField(key: NumericField, event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const value = event.target.valueAsNumber;
    this.settings.update((s) => ({ ...s, [key]: Number.isNaN(value) ? NaN : value }));
  }

  protected textValue(event: Event): string {
    return event.target instanceof HTMLInputElement ? event.target.value : '';
  }

  protected randomSeed(): void {
    this.settings.update((s) => ({ ...s, seed: randomSeed() }));
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.errors().length > 0 || this.name().trim() === '') return;
    this.create.emit({ name: this.name().trim(), settings: this.settings(), source: this.source() });
    this.close();
  }
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
