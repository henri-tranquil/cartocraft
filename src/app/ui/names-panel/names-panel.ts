import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, viewChild } from '@angular/core';
import { EditorFacade } from '../../application/editor-facade';
import {
  FeatureTemplate,
  IMPORTANCE_RANKS,
  ImportanceRank,
  geometryOf,
  MapFeature,
  MAX_FEATURE_NAME_LENGTH,
  templateOf,
} from '../../domain/features/map-feature';
import { Icon, IconName } from '../icon/icon';

interface TemplateDef {
  readonly template: FeatureTemplate;
  readonly icon: IconName;
  readonly short: string;
  readonly title: string;
}

const TEMPLATES: readonly TemplateDef[] = [
  { template: { kind: 'settlement', size: 'capital' }, icon: 'capital', short: 'Capitale', title: 'Capitale : visible sur toute la carte' },
  { template: { kind: 'settlement', size: 'city' }, icon: 'city', short: 'Ville', title: 'Ville' },
  { template: { kind: 'settlement', size: 'town' }, icon: 'town', short: 'Bourg', title: 'Bourg : petite ville' },
  { template: { kind: 'settlement', size: 'village' }, icon: 'village', short: 'Village', title: 'Village : visible de près' },
  { template: { kind: 'peak' }, icon: 'peak', short: 'Sommet', title: 'Sommet' },
  { template: { kind: 'label', tone: 'land' }, icon: 'land', short: 'Terre', title: 'Nom de terre : région, plaine, île, péninsule…' },
  { template: { kind: 'label', tone: 'water' }, icon: 'water', short: 'Eaux', title: 'Nom d’eau : mer, lac, détroit… (un point)' },
  { template: { kind: 'region', tone: 'land' }, icon: 'zone', short: 'Zone', title: 'Zone de terre : plaine, plateau, région… Glissez pour dessiner son contour' },
  { template: { kind: 'region', tone: 'water' }, icon: 'bay', short: 'Golfe', title: 'Zone d’eau : baie, golfe, lagune… Glissez pour dessiner son contour' },
  { template: { kind: 'range' }, icon: 'range', short: 'Chaîne', title: 'Chaîne de montagnes : glissez le long de la crête, le nom suivra la ligne' },
  { template: { kind: 'river' }, icon: 'river', short: 'Fleuve', title: 'Nommer un fleuve calculé : cliquez dessus (le nom suit son cours)' },
];

/** "Visible from…": the order of magnitude of the area on screen when the name appears (on a ~1000 px wide map). */
const RANK_LABELS: Record<ImportanceRank, { short: string; title: string }> = {
  1: { short: 'Toujours', title: 'Visible à toutes les échelles' },
  2: { short: 'Continent', title: 'Visible dès ~1 200 km à l’écran' },
  3: { short: 'Pays', title: 'Visible dès ~500 km à l’écran' },
  4: { short: 'Région', title: 'Visible dès ~170 km à l’écran' },
  5: { short: 'Vallée', title: 'Visible dès ~65 km à l’écran' },
};

function sameTemplate(a: FeatureTemplate, b: FeatureTemplate): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

@Component({
  selector: 'cc-names-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <p class="hint">
      @switch (newGeometry()) {
        @case ('zone') {
          Glissez sur la carte pour dessiner le contour de la zone (clic droit : déplacer la carte). Son nom n’apparaît que s’il y tient : zoomez pour les petites zones.
        }
        @case ('line') {
          Glissez le long de la crête pour tracer la chaîne (clic droit : déplacer la carte). Le nom suit la ligne s’il y tient.
        }
        @case ('river') {
          @if (facade.workspace() === 'draw') {
            Cliquez sur un fleuve dessiné pour le nommer ; glissez son nom pour le faire glisser le long du cours. Le nom n’apparaît que s’il tient le long du fleuve : zoomez pour les petits.
          } @else {
            Cliquez sur un fleuve pour le nommer ; glissez son nom pour le faire glisser le long du cours. Les fleuves apparaissent quand le climat est calculé.
          }
        }
        @default {
          Cliquez sur la carte pour poser un lieu, glissez un nom pour le déplacer. Plus on zoome, plus les petits lieux apparaissent.
        }
      }
    </p>
    <div class="templates" role="radiogroup" aria-label="Type du prochain lieu">
      @for (def of templates; track def.short) {
        <button
          type="button"
          role="radio"
          class="cc-btn shape-feuille"
          [attr.aria-checked]="isNewTemplate(def.template)"
          [title]="def.title"
          (click)="facade.setNewPlaceTemplate(def.template)"
        >
          <cc-icon [name]="def.icon" [size]="18" [strokeWidth]="2" />
          <span class="cc-caption">{{ def.short }}</span>
        </button>
      }
    </div>

    @if (facade.selectedFeature(); as feature) {
      <section class="editor cc-panel" aria-label="Lieu sélectionné">
        <label class="field">
          <span>Nom</span>
          <input
            #nameInput
            type="text"
            [maxLength]="maxName"
            [value]="feature.name"
            placeholder="Nom du lieu"
            (change)="rename(feature.id, $event)"
            (keydown.enter)="blur($event)"
            (keydown.escape)="blur($event)"
          />
        </label>
        <div class="field">
          <span>Type</span>
          <div class="row">
            @for (def of compatibleTemplates(feature); track def.short) {
              <button
                type="button"
                class="cc-btn shape-feuille mini"
                [attr.aria-pressed]="isTemplateOf(def.template, feature)"
                [attr.aria-label]="def.short"
                [title]="def.title"
                (click)="facade.setFeatureTemplate(feature.id, def.template)"
              >
                <cc-icon [name]="def.icon" [size]="14" [strokeWidth]="2.2" />
              </button>
            }
          </div>
        </div>
        <div class="field">
          <span>Visible dès</span>
          <div class="ranks" role="radiogroup" aria-label="Visible dès">
            @for (rank of ranks; track rank) {
              <button
                type="button"
                role="radio"
                class="cc-btn shape-feuille rank"
                [attr.aria-checked]="feature.rank === rank"
                [title]="rankLabels[rank].title"
                (click)="facade.setFeatureRank(feature.id, rank)"
              >
                <span class="cc-caption">{{ rankLabels[rank].short }}</span>
              </button>
            }
          </div>
        </div>
        <div class="row end">
          <button type="button" class="cc-btn shape-sceau" title="Désélectionner (Échap)" (click)="facade.selectFeature(null)">
            <cc-icon name="close" [size]="13" [strokeWidth]="2.6" />
            <span class="cc-caption">Fermer</span>
          </button>
          <button type="button" class="cc-btn shape-sceau danger" title="Supprimer ce lieu (Suppr)" (click)="facade.removeFeature(feature.id)">
            <cc-icon name="trash" [size]="13" [strokeWidth]="2.6" />
            <span class="cc-caption">Supprimer</span>
          </button>
        </div>
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; }
    .hint { margin: 0; font-size: 12px; color: var(--cc-muted); }
    .templates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .templates .cc-btn { height: 46px; flex-direction: column; gap: 3px; }
    .editor { display: flex; flex-direction: column; gap: 10px; padding: 10px; }
    .field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; font-weight: 600; }
    .field input { font: inherit; font-family: var(--cc-font-map); font-size: 15px; padding: 4px 6px; border: var(--cc-border) solid var(--cc-ink); background: var(--cc-bg); color: var(--cc-ink); }
    .row { display: flex; flex-wrap: wrap; gap: 5px; }
    .row.end { justify-content: flex-end; }
    .mini { width: 28px; height: 28px; padding: 0; --cc-shadow: 2px; }
    .ranks { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
    .rank { height: 28px; padding: 0 2px; --cc-shadow: 2px; }
    .rank .cc-caption { font-size: 9px; }
    .end .cc-btn { height: 30px; padding: 0 8px; gap: 5px; }
    .danger { color: var(--cc-danger); }
  `,
})
export class NamesPanel {
  protected readonly facade = inject(EditorFacade);
  protected readonly templates = TEMPLATES;
  protected readonly ranks = IMPORTANCE_RANKS;
  protected readonly rankLabels = RANK_LABELS;
  protected readonly maxName = MAX_FEATURE_NAME_LENGTH;
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  constructor() {
    // A freshly placed (still unnamed) place: type its name right away.
    effect(() => {
      const input = this.nameInput()?.nativeElement;
      const feature = this.facade.selectedFeature();
      if (input && feature && feature.name === '') input.focus();
    });
  }

  protected readonly newGeometry = computed(() => geometryOf(this.facade.newPlaceTemplate()));

  /** A type change keeps the geometry: a point cannot become a zone (it has no outline), nor a river a range. */
  protected compatibleTemplates(feature: MapFeature): readonly TemplateDef[] {
    const geometry = geometryOf(templateOf(feature));
    return TEMPLATES.filter((def) => geometryOf(def.template) === geometry);
  }

  protected isNewTemplate(template: FeatureTemplate): boolean {
    return sameTemplate(template, this.facade.newPlaceTemplate());
  }

  protected isTemplateOf(template: FeatureTemplate, feature: MapFeature): boolean {
    return sameTemplate(template, templateOf(feature));
  }

  protected rename(id: string, event: Event): void {
    if (event.target instanceof HTMLInputElement) this.facade.renameFeature(id, event.target.value);
  }

  protected blur(event: Event): void {
    if (event.target instanceof HTMLInputElement) event.target.blur();
  }
}
