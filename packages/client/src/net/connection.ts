import type { ClientMessage, ServerMessage } from '@cac/sim';

/** Thin JSON-over-WebSocket wrapper for the lockstep server. */
export class Connection {
  private handlers: Array<(msg: ServerMessage) => void> = [];

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data as string) as ServerMessage;
      for (const h of this.handlers) h(msg);
    });
  }

  static connect(url: string): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Connection(ws)));
      ws.addEventListener('error', () => reject(new Error(`Verbindung zu ${url} fehlgeschlagen`)));
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  onMessage(handler: (msg: ServerMessage) => void): void {
    this.handlers.push(handler);
  }

  /** Resolves with the next message of the given type. */
  waitFor<T extends ServerMessage['t']>(type: T): Promise<Extract<ServerMessage, { t: T }>> {
    return new Promise((resolve) => {
      const h = (msg: ServerMessage): void => {
        if (msg.t === type) resolve(msg as Extract<ServerMessage, { t: T }>);
      };
      this.handlers.push(h);
    });
  }
}
