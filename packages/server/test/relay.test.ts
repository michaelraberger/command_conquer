import {
  INPUT_DELAY_TICKS,
  createGame,
  hashState,
  tick,
  type ClientMessage,
  type Command,
  type GameState,
  type ServerMessage,
} from '@cac/sim';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer, type GameServer } from '../src/server.js';

/** Headless stand-in for the browser client's LockstepDriver. */
class TestClient {
  ws!: WebSocket;
  playerId = -1;
  state!: GameState;
  batches = new Map<number, Map<number, Command[]>>();
  started: Promise<void>;
  private resolveStarted!: () => void;
  hosted: Promise<string>;
  private resolveHosted!: (code: string) => void;
  desyncs = 0;

  constructor() {
    this.started = new Promise((r) => (this.resolveStarted = r));
    this.hosted = new Promise((r) => (this.resolveHosted = r));
  }

  async connect(port: number): Promise<void> {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => this.ws.on('open', () => resolve()));
    this.ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as ServerMessage;
      if (msg.t === 'hosted') this.resolveHosted(msg.code);
      if (msg.t === 'start') {
        this.playerId = msg.playerId;
        this.state = createGame(msg.seed, { factions: msg.factions, mapType: msg.mapType });
        this.resolveStarted();
      }
      if (msg.t === 'batch') {
        let per = this.batches.get(msg.tick);
        if (!per) this.batches.set(msg.tick, (per = new Map()));
        per.set(msg.playerId, msg.cmds);
      }
      if (msg.t === 'desync') this.desyncs++;
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  canTick(): boolean {
    const t = this.state.tick;
    return t < INPUT_DELAY_TICKS || (this.batches.get(t)?.size ?? 0) >= 2;
  }

  /** Runs one lockstep tick; `local` = commands issued during this tick. */
  step(local: Command[]): void {
    const t = this.state.tick;
    this.send({ t: 'cmds', tick: t + INPUT_DELAY_TICKS, cmds: local });
    let merged: Command[] = [];
    if (t >= INPUT_DELAY_TICKS) {
      const per = this.batches.get(t)!;
      this.batches.delete(t);
      merged = [...per.keys()].sort((a, b) => a - b).flatMap((id) => per.get(id)!);
    }
    tick(this.state, merged);
  }
}

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('lockstep relay', () => {
  let server: GameServer;
  beforeAll(async () => {
    server = await createGameServer(0); // ephemeral port
  });
  afterAll(async () => {
    await server.close();
  });

  it('two clients stay hash-identical over a full scripted match', async () => {
    const host = new TestClient();
    const guest = new TestClient();
    await host.connect(server.port);
    await guest.connect(server.port);

    host.send({ t: 'host', faction: 'ALLIES', mapType: 'BADLANDS' });
    const code = await host.hosted;
    guest.send({ t: 'join', code, faction: 'SOVIETS' });
    await Promise.all([host.started, guest.started]);

    expect(host.playerId).toBe(0);
    expect(guest.playerId).toBe(1);
    expect(hashState(host.state)).toBe(hashState(guest.state));

    // Each side scripts its own orders — they only meet via the relay.
    const hostScript = (t: number): Command[] => {
      if (t === 10) {
        const ids = host.state.units.filter((u) => u.owner === 0).map((u) => u.id);
        return [{ type: 'ATTACK_MOVE', playerId: 0, unitIds: ids, cx: 40, cy: 40 }];
      }
      if (t === 20) return [{ type: 'BUILD_START', playerId: 0, item: 'POWER' }];
      if (t === 120) return [{ type: 'PLACE_BUILDING', playerId: 0, cx: 17, cy: 17 }];
      if (t === 130) return [{ type: 'PLACE_WALL', playerId: 0, cx: 12, cy: 12 }];
      return [];
    };
    const guestScript = (t: number): Command[] => {
      if (t === 15) {
        const ids = guest.state.units.filter((u) => u.owner === 1).map((u) => u.id);
        return [{ type: 'MOVE', playerId: 1, unitIds: ids, cx: 30, cy: 30 }];
      }
      if (t === 25) return [{ type: 'BUILD_START', playerId: 1, item: 'POWER' }];
      return [];
    };

    for (let i = 0; i < 400; i++) {
      await waitFor(() => host.canTick());
      host.step(hostScript(host.state.tick));
      await waitFor(() => guest.canTick());
      guest.step(guestScript(guest.state.tick));

      if (host.state.tick % 50 === 0 && host.state.tick === guest.state.tick) {
        expect(hashState(host.state), `desync at tick ${host.state.tick}`).toBe(
          hashState(guest.state),
        );
      }
    }

    // Commands from both sides actually executed on both sims.
    expect(host.state.buildings.filter((b) => b.owner === 0).length).toBeGreaterThanOrEqual(3);
    expect(hashState(host.state)).toBe(hashState(guest.state));

    // The server-side hash comparison agrees (no desync broadcast).
    host.send({ t: 'hash', tick: 400, hash: hashState(host.state) });
    guest.send({ t: 'hash', tick: 400, hash: hashState(guest.state) });
    await new Promise((r) => setTimeout(r, 100));
    expect(host.desyncs).toBe(0);

    // And a fabricated mismatch IS detected.
    host.send({ t: 'hash', tick: 500, hash: 'aaaaaaaa' });
    guest.send({ t: 'hash', tick: 500, hash: 'bbbbbbbb' });
    await waitFor(() => host.desyncs > 0);
    expect(guest.desyncs).toBeGreaterThan(0);

    host.ws.close();
    guest.ws.close();
  }, 30000);
});
