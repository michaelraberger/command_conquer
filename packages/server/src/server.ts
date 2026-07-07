import type { ClientMessage, Faction, MapType, ServerMessage } from '@cac/sim';
import { WebSocket, WebSocketServer } from 'ws';

/**
 * Lockstep relay server: it never simulates anything. It pairs two players
 * into a room, hands them a shared seed, forwards every command batch to
 * both sides (tick authority lives in the message order) and compares the
 * periodic state hashes to detect desyncs.
 */
interface Room {
  code: string;
  seed: number;
  factions: [Faction, Faction];
  /** Map layout chosen by the host. */
  mapType: MapType;
  sockets: [WebSocket, WebSocket | null];
  /** tick → playerId → hash, for desync detection. */
  hashes: Map<number, Map<number, string>>;
  started: boolean;
}

export interface GameServer {
  port: number;
  close(): Promise<void>;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function roomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function createGameServer(port: number): Promise<GameServer> {
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws) => {
    let room: Room | null = null;
    let playerId = -1;

    ws.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data)) as ClientMessage;
      } catch {
        send(ws, { t: 'error', msg: 'Ungültige Nachricht' });
        return;
      }

      switch (msg.t) {
        case 'host': {
          const code = roomCode();
          room = {
            code,
            seed: Math.floor(Math.random() * 0xffffffff) >>> 0,
            factions: [msg.faction, msg.faction],
            mapType: msg.mapType ?? 'BADLANDS',
            sockets: [ws, null],
            hashes: new Map(),
            started: false,
          };
          playerId = 0;
          rooms.set(code, room);
          send(ws, { t: 'hosted', code });
          break;
        }
        case 'join': {
          const found = rooms.get(msg.code);
          if (!found || found.sockets[1] !== null || found.started) {
            send(ws, { t: 'error', msg: 'Partie nicht gefunden oder schon voll' });
            return;
          }
          room = found;
          playerId = 1;
          room.sockets[1] = ws;
          room.factions[1] = msg.faction;
          room.started = true;
          for (const id of [0, 1] as const) {
            send(room.sockets[id]!, {
              t: 'start',
              seed: room.seed,
              playerId: id,
              factions: room.factions,
              mapType: room.mapType,
            });
          }
          break;
        }
        case 'cmds': {
          if (!room || !room.started) return;
          // Stamp the sender and relay to BOTH players (sender included) —
          // one code path on the client for local and remote commands.
          const batch: ServerMessage = {
            t: 'batch',
            tick: msg.tick,
            playerId,
            cmds: msg.cmds,
          };
          for (const socket of room.sockets) if (socket) send(socket, batch);
          break;
        }
        case 'hash': {
          if (!room) return;
          let perPlayer = room.hashes.get(msg.tick);
          if (!perPlayer) {
            perPlayer = new Map();
            room.hashes.set(msg.tick, perPlayer);
          }
          perPlayer.set(playerId, msg.hash);
          if (perPlayer.size === 2) {
            const [a, b] = [...perPlayer.values()];
            if (a !== b) {
              for (const socket of room.sockets) {
                if (socket) send(socket, { t: 'desync', tick: msg.tick });
              }
            }
            room.hashes.delete(msg.tick);
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      if (!room) return;
      for (const socket of room.sockets) {
        if (socket && socket !== ws) send(socket, { t: 'left' });
      }
      rooms.delete(room.code);
    });
  });

  return new Promise((resolve) => {
    wss.on('listening', () => {
      const addr = wss.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        port: boundPort,
        close: () =>
          new Promise<void>((res) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => res());
          }),
      });
    });
  });
}
