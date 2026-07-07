import { createGame, type Faction, type GameState } from '@cac/sim';
import { Application, Container } from 'pixi.js';
import { sendCommand } from './commandQueue.js';
import { Camera } from './input/camera.js';
import { Controls } from './input/controls.js';
import { Hotkeys } from './input/hotkeys.js';
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
import { Sidebar } from './ui/sidebar.js';

interface GameSetup {
  state: GameState;
  driver: TickDriver;
  recorder: Recorder | null;
  /** Pause is client-local, so it is disabled in lockstep multiplayer. */
  canPause: boolean;
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
    conn.send({ t: 'host', faction: choice.faction, mapType: choice.mapType });
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
    state: createGame(start.seed, { factions: start.factions, mapType: start.mapType }),
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
  const sidebar = new Sidebar(state, sendCommand, placement, controls);
  const minimap = new Minimap(state, camera);
  const debug = new DebugOverlay();
  const hotkeys = new Hotkeys(state, controls, sendCommand, camera, canPause);
  const alerts = new Alerts();

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
  };
}

void boot();
