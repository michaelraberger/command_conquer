import {
  applyBalance,
  cellCenter,
  createGame,
  tick,
  type BalanceConfig,
  type Command,
  type CustomMapData,
  type Faction,
  type GameState,
} from '@cac/sim';
import { Application, Container } from 'pixi.js';
import { drainCommands, sendCommand } from './commandQueue.js';
import { cloudEnabled } from './net/supabase.js';
import { Camera } from './input/camera.js';
import { Controls } from './input/controls.js';
import { ControlGroups } from './input/groups.js';
import { Hotkeys, type CheatCodes, type CheatKind } from './input/hotkeys.js';
import { LocalDriver, startLoop, type TickDriver } from './loop.js';
import { BuildRadiusOverlay } from './render/buildRadius.js';
import { RallyOverlay } from './render/rally.js';
import { Effects } from './render/effects.js';
import { EntityRenderer } from './render/entities.js';
import { FogRenderer } from './render/fog.js';
import { OreRenderer } from './render/ore.js';
import { PatrolRouteOverlay } from './render/patrolRoutes.js';
import { PrismLinkOverlay } from './render/prismLinks.js';
import { createTextures } from './render/placeholders.js';
import { buildTerrainLayer, placeDoodads } from './render/terrain.js';
import { session } from './session.js';
import { Alerts } from './ui/alerts.js';
import { SuperweaponAlert } from './ui/swAlert.js';
import { Changelog } from './ui/changelog.js';
import { DebugOverlay } from './ui/debug.js';
import { Minimap } from './ui/minimap.js';
import { PlacementMode } from './ui/placement.js';
import { showEndScreen, showStartScreen, type StartAction, type StartChoice } from './ui/screens.js';
import { GroupBar } from './ui/groupBar.js';
import { HelpMenu } from './ui/help.js';
import { TechTreeOverlay } from './ui/techTree.js';
import { OnboardingTour } from './ui/tour.js';
import { Sidebar } from './ui/sidebar.js';

interface GameSetup {
  state: GameState;
  driver: TickDriver;
}

/** balance.json also carries a client-only `cheats` section (see below). */
interface RawConfig extends BalanceConfig {
  cheats?: Record<string, string>;
}

/** Secret cheat codes when balance.json has no `cheats` section of its own. */
const DEFAULT_CHEATS: CheatCodes = {
  money: 'MONEY',
  visible: 'REVEAL',
  power: 'POWER',
  motherload: 'MOTHERLOAD',
};
const CHEAT_KINDS = new Set<CheatKind>(['MONEY', 'REVEAL', 'POWER', 'MOTHERLOAD']);

let configPromise: Promise<RawConfig | null> | null = null;

/** Fetches and caches public/balance.json once (shared by balance + cheats). */
function loadConfig(): Promise<RawConfig | null> {
  if (!configPromise) {
    configPromise = fetch('balance.json')
      .then((res) => (res.ok ? (res.json() as Promise<RawConfig>) : null))
      .catch(() => {
        console.warn('balance.json fehlt oder ist ungültig — Standardwerte aktiv.');
        return null;
      });
  }
  return configPromise;
}

/**
 * Balance overrides from public/balance.json — retune prices, power, speeds
 * and the ore economy without touching code. The `cheats` section is stripped
 * out here; it is a client-only naming convenience, not a balance value.
 */
export async function loadBalance(): Promise<BalanceConfig | undefined> {
  const cfg = await loadConfig();
  if (!cfg) return undefined;
  const { cheats: _cheats, ...balance } = cfg;
  return balance;
}

/**
 * Cheat codes are renamable in balance.json's `cheats` map ({ "<code>":
 * "MONEY" | "REVEAL" | "POWER" }). Kept secret: nothing in the UI reveals
 * them, so operators pick their own words. Falls back to the defaults.
 */
async function loadCheatCodes(): Promise<CheatCodes> {
  const raw = (await loadConfig())?.cheats;
  if (!raw) return DEFAULT_CHEATS;
  const codes: CheatCodes = {};
  for (const [code, kind] of Object.entries(raw)) {
    if (CHEAT_KINDS.has(kind as CheatKind)) codes[code.trim().toLowerCase()] = kind as CheatKind;
  }
  return Object.keys(codes).length > 0 ? codes : DEFAULT_CHEATS;
}

async function setupFromChoice(choice: StartChoice): Promise<GameSetup> {
  const seed = (Math.random() * 0xffffffff) >>> 0;
  session.localPlayer = 0;
  const options = {
    factions: [choice.faction] as Faction[], // AI factions are assigned per player
    opponents: choice.opponents,
    ai: true,
    aiDifficulty: choice.difficulty,
    mapType: choice.mapType,
    mapWidth: choice.mapSize,
    mapHeight: choice.mapSize,
    balance: await loadBalance(),
    customMap: choice.customMap,
  };
  return { state: createGame(seed, options), driver: new LocalDriver() };
}

/** Extra context a running game carries for the save dialog. */
export interface GameMeta {
  /** Balance snapshot the game was created with (goes into save rows). */
  balance?: BalanceConfig | undefined;
  /** Display name of the map ("Ödland 64" or the custom map's name). */
  mapLabel?: string | undefined;
  /** Editor test match — the end screen offers "Zurück zum Editor". */
  testPlay?: boolean | undefined;
  /** Internet match: no pause, no cheats, no saving, no tour. */
  multiplayer?: boolean | undefined;
  /** Campaign mission: objectives HUD, progress marking, end-screen flow. */
  campaign?: import('./campaign/types.js').CampaignRef | undefined;
}

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x101418, antialias: true });
  document.getElementById('app')!.appendChild(app.canvas);

  // "Was ist neu": corner link is always live; the popup auto-opens over the
  // start screen when unseen changelog entries exist. No game dependencies.
  const changelog = new Changelog();
  void changelog.init().then(() => changelog.maybeAutoOpen());

  // "Zurück zum Editor" after a test match reloads the page with this flag set
  // (the app is one-shot per page load; the editor draft lives in localStorage).
  if (localStorage.getItem('cac-reopen') === 'editor') {
    localStorage.removeItem('cac-reopen');
    await runAction(app, { kind: 'editor' });
    return;
  }

  // Cloud UI (login box, map gallery, save list, multiplayer lobby) — no-ops
  // without Supabase env.
  const [{ initAuthUi }, { initStartTabs }, { initLobbyUi }, { initCampaignUi }] =
    await Promise.all([
      import('./ui/authUi.js'),
      import('./ui/gallery.js'),
      import('./ui/lobbyUi.js'),
      import('./ui/campaignUi.js'),
    ]);
  initAuthUi();
  initStartTabs();
  initCampaignUi();
  if (cloudEnabled()) initLobbyUi();

  const action = await showStartScreen();
  await runAction(app, action);
}

/** Dispatches a start-screen action; each branch ends in a running game. */
async function runAction(app: Application, action: StartAction): Promise<void> {
  if (action.kind === 'editor') {
    // The editor edits a flat top-down draft — no elevation while editing.
    const { clearHeightField } = await import('./render/height.js');
    clearHeightField();
    const { openEditor } = await import('./editor/editor.js');
    await openEditor(app, action.map ? { map: action.map, cloudId: action.cloudId ?? null } : undefined);
    return;
  }
  if (action.kind === 'resume') {
    // Balance is module-global and NOT part of the serialized state — it must
    // be re-applied before the first tick or unit stats silently differ.
    applyBalance(action.balance);
    session.localPlayer = 0;
    await startGame(app, action.state, new LocalDriver(), {
      balance: action.balance,
      mapLabel: action.mapLabel,
    });
    return;
  }
  if (action.kind === 'multiplayer') {
    // Internet match: every client builds the identical state from the host's
    // start payload (seed + seats + balance) and hands ticking to the
    // lockstep RemoteDriver. session.localPlayer = our seat, so every command
    // we send is stamped correctly.
    const match = action.match;
    session.localPlayer = match.localSeat;
    // Gallery map: every client fetches the identical row itself — only the
    // id travels the wire (broadcast payloads are limited, the row is not).
    let customMap: CustomMapData | undefined;
    if (match.cloudMapId !== undefined) {
      try {
        const { getMap } = await import('./net/mapsRepo.js');
        customMap = await getMap(match.cloudMapId);
      } catch (err) {
        alert(
          `Karte konnte nicht geladen werden — die Partie kann nicht starten.\n${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        location.reload();
        return;
      }
    }
    const state = createGame(match.seed, {
      multiplayer: { seats: match.seats },
      mapType: match.mapType,
      mapWidth: match.mapWidth,
      mapHeight: match.mapHeight,
      customMap,
      balance: match.balance,
    });
    const [{ RemoteDriver }, { createMpOverlay }] = await Promise.all([
      import('./net/lockstep.js'),
      import('./ui/mpOverlay.js'),
    ]);
    const driver = new RemoteDriver(match, createMpOverlay());
    if (import.meta.env.DEV) (window as unknown as { __mpDriver?: unknown }).__mpDriver = driver;
    await driver.connect();
    await startGame(app, state, driver, {
      balance: match.balance,
      mapLabel: match.mapLabel,
      multiplayer: true,
    });
    return;
  }
  const { state, driver } = await setupFromChoice(action.choice);
  await startGame(app, state, driver, {
    balance: await loadBalance(),
    mapLabel: action.choice.mapLabel,
  });
}

/** Builds the full render/input/UI stack around an existing state and starts
 *  the loop. Works for fresh games and deserialized saves alike — everything
 *  here derives from the state. */
export async function startGame(
  app: Application,
  state: GameState,
  driver: TickDriver,
  meta: GameMeta = {},
): Promise<void> {
  // Elevation is part of the projection — install BEFORE any layer is built
  // so terrain, doodads, buildings and units all agree on the same hills.
  const { installHeightField } = await import('./render/height.js');
  installHeightField(state);
  const textures = createTextures(app.renderer);

  const world = new Container();
  const terrainView = buildTerrainLayer(state, textures);
  const terrainLayer = terrainView.layer;
  const ore = new OreRenderer(textures);
  const ghostLayer = new Container();
  const entityLayer = new Container();
  entityLayer.sortableChildren = true;
  placeDoodads(state, textures, entityLayer);
  const effects = new Effects();
  const prismLinks = new PrismLinkOverlay();
  const patrolRoutes = new PatrolRouteOverlay();
  const fog = new FogRenderer(state);
  world.addChild(
    terrainLayer,
    ore.layer,
    ghostLayer,
    patrolRoutes.layer,
    entityLayer,
    prismLinks.layer,
    effects.layer,
    fog.layer,
  );
  app.stage.addChild(world);

  // Dev aid: expose the live sim state, a command injector and a manual
  // stepper (headless tabs never fire rAF) for console inspection (dev only).
  // The stepper drains the same queue as the loop, so UI clicks and injected
  // commands apply exactly like in live play.
  if (import.meta.env.DEV) {
    const w = window as unknown as { __cacState?: unknown; __cacTick?: unknown; __cacCmd?: unknown };
    w.__cacState = state;
    w.__cacCmd = sendCommand;
    w.__cacTick = (n = 1): void => {
      for (let i = 0; i < n; i++) tick(state, drainCommands());
    };
  }

  const camera = new Camera(state);
  camera.attach(app.canvas);
  const entities = new EntityRenderer(entityLayer, textures, state);
  const buildRadius = new BuildRadiusOverlay(ghostLayer);
  const rally = new RallyOverlay(ghostLayer);
  // Order acknowledgement blips: unit commands ping their target the moment
  // they are sent — instant feedback while the lockstep delay runs its course.
  const pingTargetOf = (cmd: Command): { x: number; y: number; hostile: boolean } | null => {
    switch (cmd.type) {
      case 'MOVE':
      case 'HARVEST':
      case 'PATROL':
      case 'REPAIR_BRIDGE':
        return { x: cellCenter(cmd.cx), y: cellCenter(cmd.cy), hostile: false };
      case 'ATTACK_MOVE':
        return { x: cellCenter(cmd.cx), y: cellCenter(cmd.cy), hostile: true };
      case 'ATTACK':
      case 'INFILTRATE':
      case 'CAPTURE':
      case 'REPAIR':
      case 'ESCORT':
      case 'LOAD': {
        const id = cmd.type === 'LOAD' ? cmd.transportId : cmd.targetId;
        const unit = state.units.find((u) => u.id === id);
        const building = unit ? undefined : state.buildings.find((b) => b.id === id);
        const at = unit ?? building;
        if (!at) return null;
        const hostile = cmd.type === 'ATTACK' || cmd.type === 'INFILTRATE' || cmd.type === 'CAPTURE';
        return { x: at.x, y: at.y, hostile };
      }
      default:
        return null;
    }
  };
  const sendWithPing = (cmd: Command): void => {
    const ping = pingTargetOf(cmd);
    if (ping) effects.commandPing(ping.x, ping.y, ping.hostile);
    sendCommand(cmd);
  };
  const placement = new PlacementMode(ghostLayer, state, sendCommand);
  const controls = new Controls(app, world, state, sendWithPing, placement);
  controls.isPanning = () => camera.spaceHeld;
  const groups = new ControlGroups(state, controls);
  controls.onManualSelect = () => groups.clearMarks();
  const groupBar = new GroupBar(groups);
  const sidebar = new Sidebar(state, sendCommand, placement, controls);
  const minimap = new Minimap(state, camera, fog.canvas);
  const debug = new DebugOverlay();
  const solo = meta.multiplayer !== true;
  const hotkeys = new Hotkeys(
    state,
    controls,
    sendCommand,
    camera,
    solo, // lockstep multiplayer: pausing one client would stall everyone
    // No cheat console in internet matches — an empty code map disables it.
    solo ? await loadCheatCodes() : {},
    groups,
  );
  const alerts = new Alerts();
  const swAlert = new SuperweaponAlert();
  new HelpMenu();
  new TechTreeOverlay(state);
  if (solo) {
    const tour = new OnboardingTour();
    tour.maybeShowOnFirstRun();
    const { initSaveDialog } = await import('./ui/saveDialog.js');
    initSaveDialog(state, hotkeys, meta);
  }

  ore.sync(state);
  fog.sync(state, session.localPlayer);
  minimap.sync();

  // Dev aid (headless tabs never fire rAF): re-run the loop's slow-sync layer
  // updates after manual __cacTick calls, so fog/minimap can be inspected.
  if (import.meta.env.DEV) {
    (window as unknown as { __cacSync?: unknown }).__cacSync = (): void => {
      ore.sync(state);
      fog.sync(state, session.localPlayer);
      minimap.sync();
    };
  }

  startLoop(
    app,
    state,
    {
      world,
      camera,
      controls,
      entities,
      effects,
      prismLinks,
      patrolRoutes,
      ore,
      fog,
      buildRadius,
      rally,
      sidebar,
      minimap,
      debug,
      hotkeys,
      alerts,
      swAlert,
      groups,
      groupBar,
      onGameOver: (winner) =>
        showEndScreen(winner === session.localPlayer, { backToEditor: meta.testPlay === true }),
      onSimEvents: (events) => {
        for (const e of events) {
          if (e.type === 'BRIDGE_DOWN') {
            terrainView.collapseBridge(e.cx, e.cy);
            minimap.refreshTerrain();
          } else if (e.type === 'BRIDGE_UP') {
            terrainView.restoreBridge(e.cx, e.cy);
            minimap.refreshTerrain();
          }
        }
      },
    },
    driver,
  );

  // Dev-only hook for the console and automated checks. Stripped from the
  // production build (`import.meta.env.DEV` is false there), so a deployed game
  // doesn't hand players a `__game.state…` handle to edit credits etc. from the
  // console. (A client-side game can never fully prevent devtools tampering,
  // but we don't ship an open door.)
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__game'] = {
      app,
      state,
      controls,
      camera,
      placement,
      sendCommand,
      session,
      hotkeys,
      alerts,
      groups,
      meta,
    };
  }
}

void boot();
