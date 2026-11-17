import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'compass'
  | 'maps'
  | 'relief'
  | 'climate'
  | 'wind'
  | 'tree'
  | 'water'
  | 'names'
  | 'pan'
  | 'raise'
  | 'lower'
  | 'smooth'
  | 'plus'
  | 'import'
  | 'export'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'trash'
  | 'close'
  | 'radius'
  | 'strength'
  | 'altitude'
  | 'fit';

/**
 * Inline stroke pictograms (they follow `currentColor`). Decorative by default:
 * the surrounding button carries the accessible name (aria-label + title).
 */
@Component({
  selector: 'cc-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="strokeWidth()"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      @switch (name()) {
        @case ('compass') {
          <circle cx="12" cy="12" r="9" />
          <path d="M12 4l2.5 8L12 20l-2.5-8z" fill="currentColor" />
        }
        @case ('maps') {
          <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
          <path d="M9 4v14M15 6v14" />
        }
        @case ('relief') {
          <path d="M2 20l7-11 4 6 2.5-3.5L22 20z" />
        }
        @case ('climate') {
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
        }
        @case ('tree') {
          <path d="M12 2l6 9h-3l4 6H5l4-6H6z" /><path d="M12 17v5" />
        }
        @case ('wind') {
          <path d="M3 8h11a3 3 0 10-3-3M3 12h16a3 3 0 11-3 3M3 16h8" />
        }
        @case ('water') {
          <path d="M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z" />
        }
        @case ('names') {
          <path d="M5 20L12 4l7 16M8 14h8" />
        }
        @case ('pan') {
          <path
            d="M8 13V5.5a1.5 1.5 0 013 0V12M11 11V4.5a1.5 1.5 0 013 0V12M14 11.5V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6.5 7-2.5 0-4-1.2-5.5-3.5L3 12.5a1.6 1.6 0 012.6-1.8L8 13"
          />
        }
        @case ('raise') {
          <path d="M2 20l7-11 4 6 2.5-3.5L22 20z" />
          <path d="M18 3v6M15.5 5.5L18 3l2.5 2.5" />
        }
        @case ('lower') {
          <path d="M2 8h5l5 9 5-9h5" />
          <path d="M18 2v6M15.5 5.5L18 8l2.5-2.5" />
          <path d="M2 21h20" />
        }
        @case ('smooth') {
          <path d="M2 10c3-4 5 4 8 0s5 4 8 0 3-1 4-1" />
          <path d="M2 17c3-1.5 5 1.5 8 0s5 1.5 8 0 3-.5 4-.5" />
        }
        @case ('plus') {
          <path d="M12 5v14M5 12h14" />
        }
        @case ('import') {
          <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
        }
        @case ('export') {
          <path d="M12 15V3M7 8l5-5 5 5M4 20h16" />
        }
        @case ('undo') {
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h10a6 6 0 010 12h-3" />
        }
        @case ('redo') {
          <path d="M15 14l5-5-5-5" />
          <path d="M20 9H10a6 6 0 000 12h3" />
        }
        @case ('copy') {
          <rect x="8" y="8" width="12" height="12" />
          <path d="M4 16V4h12" />
        }
        @case ('trash') {
          <path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13" />
        }
        @case ('close') {
          <path d="M6 6l12 12M18 6L6 18" />
        }
        @case ('radius') {
          <circle cx="12" cy="12" r="8" />
          <path d="M12 12h8" />
        }
        @case ('strength') {
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 010 16z" fill="currentColor" />
        }
        @case ('fit') {
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        }
        @case ('altitude') {
          <path d="M3 20l9-15 9 15z" fill="currentColor" />
        }
      }
    </svg>
  `,
  styles: `
    :host { display: inline-flex; flex: none; }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(24);
  readonly strokeWidth = input(2.2);
}
