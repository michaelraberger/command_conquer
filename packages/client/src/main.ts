import { createGame, type BalanceConfig, type Faction, type GameState } from '@cac/sim';
import { Application, Container } from 'pixi.js';
import { sendCommand } from './commandQueue.js';
import { Camera } from './input/camera.js';
import { Controls } from './input/controls.js';
import { ControlGroups } from './input/groups.js';
import { Hotkeys, type CheatCodes, type CheatKind } from './input/hotkeys.js';
import { startLoop, type TickDriver } from './loop.js';
import { Connection } from './net/connection.js';
import { LockstepDriver } from './net/lockstep.js';
import { Recorder, RecordingDriver, ReplayDriver } from './replay.js';
import { BuildRadiusOverlay } from './render/buildRadius.js';
import { Effects } from './render/effects.js';
import { EntityRenderer } from './render/entities.js';
import { FogRenderer } from './render/fog.js';
import { OreRenderer } from './render/ore.js';
import { createTextures } from './render/placeholders.js';
import { buildTerrainLayer, placeDoodads } from './render/terrain.js';
import { session } from './session.js';
import { Alerts } from './ui/alerts.js';
import { DebugOverlay } from './ui/debug.js';
import { Minimap } from './ui/minimap.js';
import { PlacementMode } from './ui/placement.js';
import {
  hideStartScreen,
  setLobbyStatus,
  showEndScreen,
  showStartScreen,
  type StartChoice,
} from './ui/screens.js';
import { GroupBar } from './ui/groupBar.js';
import { HelpMenu } from './ui/help.js';
import { Sidebar } from './ui/sidebar.js';

interface GameSetup {
  state: GameState;
  driver: TickDriver;
  recorder: Recorder | null;
  /** Pause is client-local, so it is disabled in lockstep multiplayer. */
  canPause: boolean;
}

/** balance.json also carries a client-only `cheats` section (see below). */
interface RawConfig extends BalanceConfig {
  cheats?: Record<string, string>;
}

/** Secret cheat codes when balance.json has no `cheats` section of its own. */
const DEFAULT_CHEATS: CheatCodes = { money: 'MONEY', visible: 'REVEAL', power: 'POWER' };
const CHEAT_KINDS = new Set<CheatKind>(['MONEY', 'REVEAL', 'POWER']);

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
 * and the ore economy without touching code. The config is part of the game
 * options, so replays store it and the multiplayer host hands it to the guest.
 * The `cheats` section is stripped: it is a client-only naming convenience and
 * must not leak into replays or the wire protocol.
 */
async function loadBalance(): Promise<BalanceConfig | undefined> {
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
  if (choice.mode === 'ai') {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const enemy: Faction = choice.faction === 'ALLIES' ? 'SOVIETS' : 'ALLIES';
    session.localPlayer = 0;
    const options = {
      factions: [choice.faction, enemy] as [Faction, Faction],
      ai: true,
      aiDifficulty: choice.difficulty,
      mapType: choice.mapType,
      balance: await loadBalance(),
    };
    const recorder = new Recorder(seed, options);
    return {
      state: createGame(seed, options),
      driver: new RecordingDriver(recorder),
      recorder,
      canPause: true,
    };
  }

  if (choice.mode === 'replay') {
    session.localPlayer = 0;
    return {
      state: createGame(choice.file.seed, choice.file.options),
      driver: new ReplayDriver(choice.file),
      recorder: null,
      canPause: true,
    };
  }

  setLobbyStatus('Verbinde…');
  const conn = await Connection.connect(choice.url);
  if (choice.mode === 'host') {
    conn.send({
      t: 'host',
      faction: choice.faction,
      mapType: choice.mapType,
      balance: await loadBalance(),
    });
    const hosted = await conn.waitFor('hosted');
    setLobbyStatus(`Partie eröffnet – Code: ${hosted.code} (warte auf Mitspieler …)`);
  } else {
    conn.send({ t: 'join', code: choice.code, faction: choice.faction });
    setLobbyStatus('Trete bei …');
  }
  const start = await conn.waitFor('start');
  hideStartScreen();
  session.localPlayer = start.playerId;
  conn.onMessage((msg) => {
    if (msg.t === 'desync') console.error(`DESYNC bei Tick ${msg.tick}!`);
    if (msg.t === 'left') setLobbyStatus('Der Mitspieler hat die Partie verlassen.');
  });
  return {
    state: createGame(start.seed, {
      factions: start.factions,
      mapType: start.mapType,
      balance: start.balance,
    }),
    driver: new LockstepDriver(conn),
    recorder: null,
    canPause: false,
  };
}

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x101418, antialias: true });
  document.getElementById('app')!.appendChild(app.canvas);

  const choice = await showStartScreen();
  const { state, driver, recorder, canPause } = await setupFromChoice(choice);

  if (recorder) {
    const saveBtn = document.getElementById('save-replay') as HTMLButtonElement;
    saveBtn.style.display = 'block';
    saveBtn.addEventListener('click', () => recorder.download());
  }

  const textures = createTextures(app.renderer);

  const world = new Container();
  const terrainLayer = buildTerrainLayer(state, textures);
  const ore = new OreRenderer(textures);
  const ghostLayer = new Container();
  const entityLayer = new Container();
  entityLayer.sortableChildren = true;
  placeDoodads(state, textures, entityLayer);
  const effects = new Effects();
  const fog = new FogRenderer(state, textures);
  world.addChild(terrainLayer, ore.layer, ghostLayer, entityLayer, effects.layer, fog.layer);
  app.stage.addChild(world);

  const camera = new Camera(state);
  camera.attach(app.canvas);
  const entities = new EntityRenderer(entityLayer, textures, state);
  const buildRadius = new BuildRadiusOverlay(ghostLayer);
  const placement = new PlacementMode(ghostLayer, state, sendCommand);
  const controls = new Controls(app, world, state, sendCommand, placement);
  controls.isPanning = () => camera.spaceHeld;
  const groups = new ControlGroups(state, controls);
  controls.onManualSelect = () => groups.clearMarks();
  const groupBar = new GroupBar(groups);
  const sidebar = new Sidebar(state, sendCommand, placement, controls);
  const minimap = new Minimap(state, camera);
  const debug = new DebugOverlay();
  const hotkeys = new Hotkeys(
    state,
    controls,
    sendCommand,
    camera,
    canPause,
    await loadCheatCodes(),
    groups,
  );
  const alerts = new Alerts();
  new HelpMenu();

  ore.sync(state);
  fog.sync(state, session.localPlayer);
  minimap.sync();

  startLoop(
    app,
    state,
    {
      world,
      camera,
      controls,
      entities,
      effects,
      ore,
      fog,
      buildRadius,
      sidebar,
      minimap,
      debug,
      hotkeys,
      alerts,
      groups,
      groupBar,
      onGameOver: (winner) =>
        showEndScreen(winner === session.localPlayer, recorder ? () => recorder.download() : null),
    },
    driver,
  );

  // Dev/test hook: lets the console and automated checks inspect the game.
  (window as unknown as Record<string, unknown>)['__game'] = {
    app,
    state,
    controls,
    camera,
    placement,
    sendCommand,
    session,
    recorder,
    hotkeys,
    alerts,
    groups,
  };
}

void boot();
