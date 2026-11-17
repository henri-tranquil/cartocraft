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

export interface NewMapRequest {
  readonly name: string;
  readonly settings: MapSettings;
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

        @for (field of fields; track field.key) {
          <label class="field">
            <span>{{ field.label }}</span>
            <input type="number" [step]="field.step" [value]="settings()[field.key]" (input)="setField(field.key, $event)" />
            <small>{{ field.unit }}</small>
            @if (field.key === 'seed') {
              <button type="button" (click)="randomSeed()" title="Graine aléatoire">🎲</button>
            }
          </label>
        }

        <p class="summary">Grille : {{ grid().widthCells }} × {{ grid().heightCells }} cellules</p>
        <p class="note">Relief : vierge (mer peu profonde). La génération procédurale viendra avec le relief.</p>

        @if (errors().length > 0) {
          <ul class="errors" role="alert">
            @for (error of errors(); track error) {
              <li>{{ error }}</li>
            }
          </ul>
        }

        <div class="actions">
          <button type="button" (click)="close()">Annuler</button>
          <button type="submit" [disabled]="errors().length > 0 || name().trim() === ''">Créer</button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    dialog { border: 1px solid #c8b99a; border-radius: 6px; background: #faf5ea; min-width: 22rem; }
    h2 { font-family: Georgia, serif; margin-top: 0; }
    .field { display: grid; grid-template-columns: 11rem 7rem auto auto; gap: 0.5rem; align-items: center; margin: 0.35rem 0; }
    .summary { font-weight: bold; }
    .note { color: #7a6a50; font-style: italic; font-size: 0.9em; }
    .errors { color: #a03020; }
    .actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
  `,
})
export class NewMapDialog {
  readonly create = output<NewMapRequest>();

  protected readonly fields = FIELDS;
  protected readonly name = signal('Nouvelle carte');
  protected readonly settings = signal<MapSettings>(DEFAULT_MAP_SETTINGS);
  protected readonly errors = computed(() => validateMapSettings(this.settings()));
  protected readonly grid = computed(() =>
    this.errors().length === 0 ? gridSizeCells(this.settings()) : { widthCells: '–', heightCells: '–' },
  );

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  open(): void {
    this.name.set('Nouvelle carte');
    this.settings.set({ ...DEFAULT_MAP_SETTINGS, seed: randomSeed() });
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
    this.create.emit({ name: this.name().trim(), settings: this.settings() });
    this.close();
  }
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
