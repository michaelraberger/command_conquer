import { TICK_MS, tick, type Command, type GameState } from '@cac/sim';
import type { Application, Container } from 'pixi.js';
import { drainCommands } from './commandQueue.js';
import type { Camera } from './input/camera.js';
import type { Controls } from './input/controls.js';
import type { ControlGroups } from './input/groups.js';
import type { Hotkeys } from './input/hotkeys.js';
import type { BuildRadiusOverlay } from './render/buildRadius.js';
import type { Effects } from './render/effects.js';
import type { EntityRenderer } from './render/entities.js';
import type { FogRenderer } from './render/fog.js';
import type { OreRenderer } from './render/ore.js';
import type { PatrolRouteOverlay } from './render/patrolRoutes.js';
import type { PrismLinkOverlay } from './render/prismLinks.js';
import type { RallyOverlay } from './render/rally.js';
import { session } from './session.js';
import type { Alerts } from './ui/alerts.js';
import type { DebugOverlay } from './ui/debug.js';
import type { GroupBar } from './ui/groupBar.js';
import type { Minimap } from './ui/minimap.js';
import type { Sidebar } from './ui/sidebar.js';

const MAX_TICKS_PER_FRAME = 10;
/** Minimap/ore/fog refresh cadence in sim ticks. */
const SLOW_SYNC_TICKS = 5;

/** Where the loop gets its per-tick commands (local play vs. lockstep). */
export interface TickDriver {
  canTick(nextTick: number): boolean;
  commandsFor(nextTick: number): Command[];
  onTicked(state: GameState): void;
  /**
   * Extra ticks to fast-forward this frame (lockstep catch-up): the
   * accumulator is clamped per frame and zeroed after bursts, so a tab that
   * was hidden — rAF stops, remote frames keep arriving — could otherwise
   * never catch up to its peers. Absent/0 for local play.
   */
  catchUpTicks?(): number;
}

export class LocalDriver implements TickDriver {
  canTick(): boolean {
    return true;
  }
  commandsFor(): Command[] {
    return drainCommands();
  }
  onTicked(): void {}
}

export interface LoopDeps {
  world: Container;
  camera: Camera;
  controls: Controls;
  entities: EntityRenderer;
  effects: Effects;
  prismLinks: PrismLinkOverlay;
  patrolRoutes: PatrolRouteOverlay;
  ore: OreRenderer;
  fog: FogRenderer;
  buildRadius: BuildRadiusOverlay;
  rally: RallyOverlay;
  sidebar: Sidebar;
  minimap: Minimap;
  debug: DebugOverlay;
  hotkeys: Hotkeys;
  alerts: Alerts;
  groups: ControlGroups;
  groupBar: GroupBar;
  onGameOver: (winner: number) => void;
  /** Extra per-tick event hook (bridge collapses patch terrain + minimap). */
  onSimEvents?: (events: GameState['events']) => void;
}

/**
 * Fixed-timestep driver: the sim advances in 15 Hz ticks, rendering runs at
 * display refresh and interpolates with the leftover accumulator fraction.
 * In multiplayer the driver may refuse to tick (waiting for remote input).
 */
export function startLoop(
  app: Application,
  state: GameState,
  deps: LoopDeps,
  driver: TickDriver,
): void {
  let accumulator = 0;
  let gameOverReported = false;
  const attackBanner = document.getElementById('attack')!;

  app.ticker.add(() => {
    accumulator += Math.min(app.ticker.deltaMS, 250);
    // Lockstep catch-up: when the driver is behind the network frontier
    // (hidden tab, long stall), grant extra tick budget beyond wall time.
    const extra = driver.catchUpTicks?.() ?? 0;
    if (extra > 0) accumulator += TICK_MS * extra;
    let steps = 0;
    while (accumulator >= TICK_MS && steps < MAX_TICKS_PER_FRAME) {
      if (deps.hotkeys.paused) {
        accumulator = Math.min(accumulator, TICK_MS); // freeze, no burst on resume
        break;
      }
      if (!driver.canTick(state.tick)) {
        accumulator = Math.min(accumulator, TICK_MS * 2); // don't burst after a stall
        break;
      }
      deps.entities.snapshotPrev(state);
      tick(state, driver.commandsFor(state.tick));
      driver.onTicked(state);
      deps.effects.ingest(state.events); // events are cleared next tick
      deps.onSimEvents?.(state.events);
      accumulator -= TICK_MS;
      steps++;
    }
    if (steps === MAX_TICKS_PER_FRAME) accumulator = 0;

    if (steps > 0) {
      pruneDeadSelection(state, deps.controls);
      deps.alerts.update(state);
      if (state.tick % SLOW_SYNC_TICKS < steps) {
        deps.ore.sync(state);
        deps.fog.sync(state, session.localPlayer);
        deps.minimap.sync(deps.alerts.ping(state.tick));
      }
      if (!gameOverReported && state.winner !== -1) {
        gameOverReported = true;
        deps.onGameOver(state.winner);
      }
    }

    const attackActive = deps.alerts.active(state.tick);
    if (attackActive) attackBanner.firstElementChild!.textContent = deps.alerts.message();
    attackBanner.style.display = attackActive ? 'flex' : 'none';

    const { width, height } = app.screen;
    deps.camera.update(app.ticker.deltaMS, width, height);
    deps.camera.apply(deps.world, width, height);
    deps.entities.render(state, accumulator / TICK_MS, deps.controls.selected, deps.groups.tags());
    deps.prismLinks.update(state, app.ticker.deltaMS);
    deps.patrolRoutes.update(state, deps.controls.selected, deps.hotkeys.showAllRadius);
    deps.effects.update(app.ticker.deltaMS);
    deps.buildRadius.update(state, deps.controls.selectedBuilding, deps.hotkeys.showAllRadius);
    deps.rally.update(state, deps.controls.selectedBuilding);
    deps.groupBar.sync();
    deps.sidebar.update();
    deps.debug.update(state, app.ticker.FPS, deps.controls.selected.size);
  });
}

function pruneDeadSelection(state: GameState, controls: Controls): void {
  if (controls.selected.size > 0) {
    const alive = new Set<number>();
    for (const unit of state.units) alive.add(unit.id);
    for (const id of controls.selected) {
      if (!alive.has(id)) controls.selected.delete(id);
    }
  }
  if (
    controls.selectedBuilding !== null &&
    !state.buildings.some((b) => b.id === controls.selectedBuilding)
  ) {
    controls.selectedBuilding = null;
  }
}
