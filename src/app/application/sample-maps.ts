import { inject, Injectable } from '@angular/core';
import { MAP_FILE_CODEC, MAP_REPOSITORY } from './ports';
import { SAMPLE_MAPS, SampleMap } from './samples';

const VERSION_KEY_PREFIX = 'cartocraft:sample:';

/**
 * Installs the bundled sample maps into the local library, once per sample
 * version. A sample the user deleted is not reinstalled until its next version.
 * Only EditorFacade should call this.
 */
@Injectable({ providedIn: 'root' })
export class SampleMaps {
  private readonly repository = inject(MAP_REPOSITORY);
  private readonly codec = inject(MAP_FILE_CODEC);

  async install(): Promise<void> {
    const stored = new Set((await this.repository.list()).map((m) => m.id));
    for (const sample of SAMPLE_MAPS) {
      const known = readVersion(sample);
      const outdated = known < sample.version;
      const firstTime = known === 0 && !stored.has(sample.id);
      if (!outdated && !firstTime) continue;
      try {
        const response = await fetch(new URL(sample.path, document.baseURI));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const map = await this.codec.importMap(await response.blob());
        // Unlike a user import, a sample keeps its fixed id: updates replace it.
        await this.repository.save({ ...map, id: sample.id, name: sample.name }, 'all');
        writeVersion(sample);
      } catch (error) {
        console.warn(`Sample map "${sample.name}" not installed`, error);
      }
    }
  }
}

function readVersion(sample: SampleMap): number {
  try {
    return Number(localStorage.getItem(VERSION_KEY_PREFIX + sample.id)) || 0;
  } catch {
    return 0;
  }
}

function writeVersion(sample: SampleMap): void {
  try {
    localStorage.setItem(VERSION_KEY_PREFIX + sample.id, String(sample.version));
  } catch {
    // Storage unavailable: the sample is simply reinstalled next time.
  }
}
