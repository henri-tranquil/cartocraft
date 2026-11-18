import { DrawnRiverEditCommand } from '../../domain/commands/drawn-river-edit-command';
import { courseUpTo, DrawnRiver, planRiver, RiverPlan, reversePolyline, riverEnd, riverNear, RiverSnap, riverSnapAt } from '../../domain/drawing/drawn-river';
import { RiverEdit } from '../../domain/commands/drawn-river-edit-command';
import { simplifyPolyline } from '../../domain/features/polygon';
import { WorldMap } from '../../domain/map/world-map';
import { CellPoint } from '../../domain/terrain/brushes';
import { EditorTool, ToolContext, ToolResult } from './editor-tool';

/** Screen size of the pointer's precision: simplification tolerance and picking radius. */
const SIMPLIFY_PX = 1.5;
const PICK_PX = 8;
const SNAP_PX = 12;

/**
 * Traces a river freehand: press at the source, drag to the sea (or to
 * another river), release. The stroke is shown raw while drawing, then
 * cleaned up by `planRiver` (simplified, oriented, cut at the coast or at
 * the river it joins). One gesture = one undoable command.
 *
 * Magnet (`riverSnapAt`): pressing near an existing river's source, or the
 * end of a river leading nowhere, EXTENDS that river; pressing near its
 * course starts a TRIBUTARY from there.
 */
export class RiverDrawTool implements EditorTool {
  private stroke: number[] = [];
  private snap: RiverSnap | null = null;

  constructor(
    /** Km per screen pixel at the current zoom. */
    private readonly kmPerPx: () => number,
    private readonly onPreview: (pointsKm: readonly number[] | null) => void,
  ) {}

  /** Where a stroke starting at `point` would attach (shown under the pointer before pressing). */
  snapAt(map: WorldMap, point: CellPoint): RiverSnap | null {
    const km = map.settings.baseCellKm;
    return riverSnapAt(map.rivers, map.terrain.drawing, km, point.x * km, point.y * km, this.kmPerPx() * SNAP_PX);
  }

  begin(ctx: ToolContext, point: CellPoint): void {
    const km = ctx.map.settings.baseCellKm;
    this.snap = this.snapAt(ctx.map, point);
    this.stroke = this.snap ? [this.snap.x, this.snap.y] : [point.x * km, point.y * km];
    this.onPreview(this.stroke);
  }

  move(ctx: ToolContext, point: CellPoint): void {
    if (this.stroke.length === 0) return;
    const km = ctx.map.settings.baseCellKm;
    const x = point.x * km;
    const y = point.y * km;
    const n = this.stroke.length;
    // Points closer than a pixel add nothing but work.
    if (Math.hypot(x - this.stroke[n - 2], y - this.stroke[n - 1]) < this.kmPerPx()) return;
    this.stroke.push(x, y);
    this.onPreview([...this.stroke]);
  }

  end(ctx: ToolContext): ToolResult | null {
    const raw = this.stroke;
    const snap = this.snap;
    this.stroke = [];
    this.snap = null;
    this.onPreview(null);
    const map = ctx.map;
    const cellKm = map.settings.baseCellKm;
    const stroke = simplifyPolyline(raw, Math.max(cellKm * 0.25, this.kmPerPx() * SIMPLIFY_PX));
    if (stroke.length < 4) return null;
    // Already simplified: tolerance 0 keeps the existing course of an extended river exactly (its tributaries stay on it).
    const base = { drawing: map.terrain.drawing, cellKm, toleranceKm: 0, snapKm: this.kmPerPx() * SNAP_PX, allRivers: map.rivers };

    const leadsNowhere = (river: DrawnRiver) => riverEnd(river, map.rivers, map.terrain.drawing, cellKm) === 'inland';
    const reachesOutlet = (points: readonly number[], others: readonly DrawnRiver[]) =>
      riverEnd({ id: '', pointsKm: points }, others, map.terrain.drawing, cellKm) !== 'inland';
    const edits: RiverEdit[] = [];
    let label = 'Tracer un fleuve';
    let plan: RiverPlan | null = null;

    if (snap && snap.kind !== 'branch') {
      const river = snap.river;
      const combined = snap.kind === 'source' ? [...reversePolyline(stroke), ...river.pointsKm.slice(2)] : [...river.pointsKm, ...stroke.slice(2)];
      plan = planRiver(combined, { ...base, rivers: map.rivers.filter((r) => r !== river), direction: 'asDrawn' });
      if (!plan) return null;
      label = 'Prolonger un fleuve';
      edits.push({ before: river, after: { id: river.id, pointsKm: roundKm(plan.pointsKm) } });
    } else {
      // A river leading nowhere, joined from its course to the sea: it is EXTENDED from there
      // (its dead-end tail is dropped), instead of getting a tributary flowing into it.
      const isolated = snap && leadsNowhere(snap.river) ? snap.river : null;
      if (snap && isolated) {
        const others = map.rivers.filter((r) => r !== isolated);
        const outward = planRiver(stroke, { ...base, rivers: others, direction: 'asDrawn' });
        if (outward && reachesOutlet(outward.pointsKm, others)) {
          plan = outward;
          label = 'Prolonger un fleuve';
          const course = [...courseUpTo(isolated.pointsKm, snap.x, snap.y), ...outward.pointsKm.slice(2)];
          edits.push({ before: isolated, after: { id: isolated.id, pointsKm: roundKm(course) } });
        }
      }
      if (!plan) {
        // From the course of a river: a tributary, whose mouth is where the stroke started.
        plan = planRiver(stroke, { ...base, rivers: map.rivers, direction: snap ? 'reversed' : 'auto' });
        if (!plan) return null;
        const reattachedIds = new Set(plan.reattached.map((e) => e.before.id));
        // Drawn from the sea and stopped ON the course of a river leading nowhere: that river flows on through the new course.
        const sx = plan.pointsKm[0];
        const sy = plan.pointsKm[1];
        const upstream = !snap
          ? map.rivers.find((r) => !reattachedIds.has(r.id) && leadsNowhere(r) && riverSnapAt([r], map.terrain.drawing, cellKm, sx, sy, base.snapKm) !== null)
          : undefined;
        if (upstream && reachesOutlet(plan.pointsKm, map.rivers)) {
          label = 'Prolonger un fleuve';
          const course = [...courseUpTo(upstream.pointsKm, sx, sy), ...plan.pointsKm.slice(2)];
          edits.push({ before: upstream, after: { id: upstream.id, pointsKm: roundKm(course) } });
        } else {
          edits.push({ before: null, after: { id: crypto.randomUUID(), pointsKm: roundKm(plan.pointsKm) } });
        }
      }
    }
    const touched = new Set(edits.map((e) => e.before?.id));
    for (const { before, after } of plan.reattached) {
      if (!touched.has(before.id)) edits.push({ before, after: { ...after, pointsKm: roundKm(after.pointsKm) } });
    }
    const command = new DrawnRiverEditCommand(label, edits);
    // Tools hand back gestures already applied.
    return { command, change: command.execute(map) };
  }
}

/** Click on a river to delete it (its tributaries stay: they now end inland, and a warning says so). */
export class RiverEraseTool implements EditorTool {
  private picked = false;

  constructor(private readonly kmPerPx: () => number) {}

  begin(ctx: ToolContext, point: CellPoint): void {
    this.picked = false;
    this.pick(ctx, point);
  }

  move(ctx: ToolContext, point: CellPoint): void {
    this.pick(ctx, point);
  }

  private result: ToolResult | null = null;

  /** One river per gesture: the first one under the pointer. */
  private pick(ctx: ToolContext, point: CellPoint): void {
    if (this.picked) return;
    const km = ctx.map.settings.baseCellKm;
    const river = riverNear(ctx.map.rivers, point.x * km, point.y * km, this.kmPerPx() * PICK_PX);
    if (!river) return;
    this.picked = true;
    const command = new DrawnRiverEditCommand('Effacer un fleuve', { before: river, after: null });
    this.result = { command, change: command.execute(ctx.map) };
  }

  end(): ToolResult | null {
    const result = this.result;
    this.result = null;
    this.picked = false;
    return result;
  }
}

/** Metre precision is plenty, and keeps saved files small. */
function roundKm(points: readonly number[]): number[] {
  return points.map((v) => Math.round(v * 1000) / 1000);
}
