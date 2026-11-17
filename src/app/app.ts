import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EditorShell } from './ui/editor-shell/editor-shell';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditorShell],
  template: '<cc-editor-shell />',
})
export class App {}
