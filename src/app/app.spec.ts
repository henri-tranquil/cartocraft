import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { appConfig } from './app.config';

describe('App', () => {
  it('renders the top bar with the maps menu and an empty state', async () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Mes cartes');
    expect(el.textContent).toContain('Aucune carte ouverte');
  });
});
