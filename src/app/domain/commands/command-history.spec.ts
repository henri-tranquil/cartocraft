import { MapFactory } from '../map/map-factory';
import { DEFAULT_MAP_SETTINGS } from '../map/map-settings';
import { WorldMap } from '../map/world-map';
import { getCell, setCell, tileIndexAt } from '../terrain/tiled-grid';
import { CommandHistory } from './command-history';
import { RenameMapCommand } from './rename-map-command';
import { TileChangeRecorder } from './terrain-edit-command';

function newMap(): WorldMap {
  return MapFactory.blank(
    { ...DEFAULT_MAP_SETTINGS, widthKm: 600, heightKm: 300 },
    { id: 'm', name: 'Initial', nowIso: '2026-01-01T00:00:00.000Z' },
  );
}

describe('CommandHistory', () => {
  it('undoes and redoes in order', () => {
    const map = newMap();
    const history = new CommandHistory();
    history.execute(new RenameMapCommand('A'), map);
    history.execute(new RenameMapCommand('B'), map);
    history.undo(map);
    expect(map.name).toBe('A');
    history.undo(map);
    expect(map.name).toBe('Initial');
    expect(history.undo(map)).toBeNull();
    history.redo(map);
    expect(map.name).toBe('A');
  });

  it('clears the redo stack on a new command', () => {
    const map = newMap();
    const history = new CommandHistory();
    history.execute(new RenameMapCommand('A'), map);
    history.undo(map);
    history.execute(new RenameMapCommand('C'), map);
    expect(history.redo(map)).toBeNull();
    expect(history.redoLabel).toBeNull();
  });

  it('forgets the oldest entries beyond its bound', () => {
    const map = newMap();
    const history = new CommandHistory(2);
    for (const name of ['A', 'B', 'C']) history.execute(new RenameMapCommand(name), map);
    history.undo(map);
    history.undo(map);
    expect(history.undo(map)).toBeNull();
    expect(map.name).toBe('A');
  });
});

describe('CommandHistory memory budget', () => {
  it('drops the oldest commands when the byte budget is exceeded', () => {
    const map = newMap();
    const history = new CommandHistory(100, 250);
    const heavy = (name: string) => Object.assign(new RenameMapCommand(name), { sizeBytes: 100 });
    for (const name of ['A', 'B', 'C']) history.execute(heavy(name), map);
    history.undo(map);
    history.undo(map);
    expect(history.undo(map)).toBeNull();
  });
});

describe('TerrainEditCommand via TileChangeRecorder', () => {
  it('records only changed tiles and restores them on undo/redo', () => {
    const map = newMap();
    const grid = map.terrain.baseAltitudeM;
    const recorder = new TileChangeRecorder(grid);
    const history = new CommandHistory();

    recorder.touch(tileIndexAt(grid, 10, 10));
    setCell(grid, 10, 10, 800);
    recorder.touch(tileIndexAt(grid, 300, 10)); // touched but left unchanged
    const command = recorder.finish('Élever le relief');
    expect(command).not.toBeNull();
    history.record(command!);

    const undoChange = history.undo(map);
    expect(getCell(grid, 10, 10)).toBe(-200);
    expect(undoChange?.terrainTiles).toEqual([0]);

    history.redo(map);
    expect(getCell(grid, 10, 10)).toBe(800);
  });

  it('returns null when nothing changed', () => {
    const map = newMap();
    const recorder = new TileChangeRecorder(map.terrain.baseAltitudeM);
    recorder.touch(0);
    expect(recorder.finish('rien')).toBeNull();
  });
});
