import type { RealtimeChannel } from '@supabase/supabase-js';
import type { BalanceConfig, Faction, MapType, MultiplayerSeat } from '@cac/sim';
import { getSupabase } from './supabase.js';

/**
 * Private match lobby over a Supabase Realtime channel — no DB tables, no own
 * server. The lobby lives in the channel `cac:lobby:<CODE>`: presence carries
 * who is here (and their faction pick), the host broadcasts the map settings
 * and finally the `start` payload every client builds its identical game from.
 */

/** Bumped whenever the sim or the net protocol changes incompatibly — a
 *  version mismatch between peers would desync within seconds, so the lobby
 *  refuses to start across versions. */
export const NET_VERSION = 1;

export const MAX_SEATS = 4;

/** Join codes: 6 chars, no look-alikes (I/O/0/1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeJoinCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]!).join('');
}

export interface LobbyPlayer {
  userId: string;
  username: string;
  faction: Faction;
  host: boolean;
  joinedAt: number;
}

export interface LobbySettings {
  mapType: MapType;
  /** Side length in cells (48/64/96); ignored when a cloud map is chosen. */
  mapSize: number;
  /**
   * Hand-authored map from the gallery. Only its id travels the wire — every
   * client fetches the identical row itself (broadcast payloads are limited).
   * PUBLIC maps only: joiners cannot read the host's private rows (RLS).
   */
  cloudMap?: { id: string; name: string; maxPlayers: number } | null;
}

/** The host's start payload — every client derives the identical game from it. */
export interface MatchStart {
  code: string;
  seed: number;
  seats: MultiplayerSeat[];
  /** Index into `seats` (= sim player id) of the local player. */
  localSeat: number;
  mapType: MapType;
  mapWidth: number;
  mapHeight: number;
  /** Gallery map id — every client fetches the identical row via mapsRepo;
   *  mapType/mapWidth/mapHeight are ignored by the sim in that case. */
  cloudMapId: string | undefined;
  /** Display name ("Ödland 64" or the cloud map's name). */
  mapLabel: string;
  /** Host's balance snapshot — MUST be applied on every client (identical
   *  rules), differently deployed balance.json files would desync tick 0. */
  balance: BalanceConfig | undefined;
}

interface StartPayload {
  version: number;
  seed: number;
  mapType: MapType;
  mapWidth: number;
  mapHeight: number;
  cloudMapId: string | null;
  mapLabel: string;
  balance: BalanceConfig | null;
  seats: Array<{ userId: string; username: string; faction: Faction }>;
}

export interface LobbyEvents {
  /** Fired on every presence change with the deterministic seat order. */
  onPlayers: (players: LobbyPlayer[]) => void;
  /** Host settings changed (joiners render them read-only). */
  onSettings: (settings: LobbySettings) => void;
  /** The match starts — leave the lobby UI and boot the game. */
  onStart: (match: MatchStart) => void;
  /** Lobby became unusable (host left, version mismatch, kicked …). */
  onClosed: (reason: string) => void;
}

const DEFAULT_SETTINGS: LobbySettings = { mapType: 'BADLANDS', mapSize: 64, cloudMap: null };

const MAP_TYPE_LABELS: Record<MapType, string> = {
  BADLANDS: 'Ödland',
  RIVER: 'Flusstal',
  ISLANDS: 'Inselgruppe',
};

/** Deterministic seat order shared by every client: host first, then join
 *  time, ties broken by userId. */
function orderPlayers(players: LobbyPlayer[]): LobbyPlayer[] {
  return [...players].sort((a, b) => {
    if (a.host !== b.host) return a.host ? -1 : 1;
    if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
    return a.userId < b.userId ? -1 : 1;
  });
}

export class Lobby {
  private channel: RealtimeChannel | null = null;
  private settings: LobbySettings = { ...DEFAULT_SETTINGS };
  private started = false;
  private closed = false;

  private constructor(
    readonly code: string,
    readonly isHost: boolean,
    private readonly self: { userId: string; username: string },
    private readonly events: LobbyEvents,
  ) {}

  /** Creates a fresh lobby and becomes its host. */
  static async create(
    self: { userId: string; username: string },
    events: LobbyEvents,
  ): Promise<Lobby> {
    // Collision odds are negligible (32^6); one retry keeps them theoretical.
    for (let attempt = 0; attempt < 2; attempt++) {
      const lobby = new Lobby(makeJoinCode(), true, self, events);
      const ok = await lobby.open();
      if (ok) return lobby;
      await lobby.leave();
    }
    throw new Error('Lobby konnte nicht erstellt werden — bitte erneut versuchen.');
  }

  /** Joins an existing lobby by code. */
  static async join(
    code: string,
    self: { userId: string; username: string },
    events: LobbyEvents,
  ): Promise<Lobby> {
    const lobby = new Lobby(code.trim().toUpperCase(), false, self, events);
    const ok = await lobby.open();
    if (!ok) {
      await lobby.leave();
      throw new Error('Code ungültig oder Lobby aufgelöst.');
    }
    return lobby;
  }

  /** Subscribes, validates the room and announces our presence.
   *  Returns false when the room is unusable (occupied code / no host / full). */
  private async open(): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Cloud nicht konfiguriert.');

    const channel = supabase.channel(`cac:lobby:${this.code}`, {
      config: { presence: { key: this.self.userId }, broadcast: { self: true } },
    });
    this.channel = channel;

    // The room validation below must see the server's presence snapshot —
    // it arrives as the first 'sync' event shortly AFTER subscribing.
    let firstSync: (() => void) | null = null;
    const synced = new Promise<void>((resolve) => {
      firstSync = resolve;
    });
    channel.on('presence', { event: 'sync' }, () => {
      firstSync?.();
      firstSync = null;
      this.handlePresence();
    });
    channel.on('broadcast', { event: 'settings' }, ({ payload }) => {
      this.settings = payload as LobbySettings;
      this.events.onSettings(this.settings);
    });
    channel.on('broadcast', { event: 'start' }, ({ payload }) => {
      this.handleStart(payload as StartPayload);
    });

    const status = await new Promise<string>((resolve) => {
      channel.subscribe((s) => resolve(s), 10_000);
    });
    if (status !== 'SUBSCRIBED') return false;
    await Promise.race([synced, new Promise((r) => setTimeout(r, 3000))]);

    // First presence snapshot BEFORE we track ourselves: validate the room.
    const before = this.presencePlayers();
    if (this.isHost) {
      if (before.length > 0) return false; // code already in use
    } else {
      if (!before.some((p) => p.host)) return false; // no host → dead room
      if (before.length >= MAX_SEATS) {
        this.events.onClosed('Lobby voll (max. 4 Spieler).');
        return false;
      }
    }

    await channel.track({
      userId: this.self.userId,
      username: this.self.username,
      faction: 'ALLIES' satisfies Faction,
      host: this.isHost,
      joinedAt: Date.now(),
    });
    if (this.isHost) this.events.onSettings(this.settings);
    return true;
  }

  private presencePlayers(): LobbyPlayer[] {
    const state = this.channel?.presenceState() ?? {};
    const players: LobbyPlayer[] = [];
    for (const metas of Object.values(state)) {
      const meta = (metas as unknown as LobbyPlayer[])[0];
      if (meta && typeof meta.userId === 'string') players.push(meta);
    }
    return orderPlayers(players);
  }

  private handlePresence(): void {
    if (this.closed || this.started) return;
    const players = this.presencePlayers();
    // Host gone → the lobby is dead for everyone else.
    if (!this.isHost && players.length > 0 && !players.some((p) => p.host)) {
      this.close('Host hat die Lobby aufgelöst.');
      return;
    }
    this.events.onPlayers(players);
    // Late joiners need the current settings — re-broadcast (host only).
    if (this.isHost) this.broadcastSettings();
  }

  /** Host: update the map settings (mirrored read-only on every joiner). */
  setSettings(settings: LobbySettings): void {
    if (!this.isHost) return;
    this.settings = settings;
    this.events.onSettings(settings);
    this.broadcastSettings();
  }

  private broadcastSettings(): void {
    void this.channel?.send({ type: 'broadcast', event: 'settings', payload: this.settings });
  }

  /** Own faction pick — travels via presence, so everyone's list updates. */
  async setFaction(faction: Faction): Promise<void> {
    await this.channel?.track({
      userId: this.self.userId,
      username: this.self.username,
      faction,
      host: this.isHost,
      joinedAt: this.joinedAtOfSelf(),
    });
  }

  private joinedAtOfSelf(): number {
    const self = this.presencePlayers().find((p) => p.userId === this.self.userId);
    return self?.joinedAt ?? Date.now();
  }

  /** Host: freeze the current line-up and start the match on every client.
   *  The balance snapshot rides along so all sims run identical rules.
   *  Returns an error message when starting is not possible right now. */
  startWith(balance: BalanceConfig | undefined): string | null {
    if (!this.isHost || this.started) return null;
    const players = this.presencePlayers();
    if (players.length < 2) return 'Mindestens 2 Spieler nötig.';
    const cloud = this.settings.cloudMap ?? null;
    if (cloud && players.length > cloud.maxPlayers) {
      return `Die Karte „${cloud.name}" erlaubt nur ${cloud.maxPlayers} Spieler.`;
    }
    const seedBytes = new Uint32Array(1);
    crypto.getRandomValues(seedBytes);
    const sizeLabel =
      this.settings.mapSize === 48 ? '48' : this.settings.mapSize === 96 ? '96' : '64';
    const payload: StartPayload = {
      version: NET_VERSION,
      seed: seedBytes[0]! >>> 0,
      mapType: this.settings.mapType,
      mapWidth: this.settings.mapSize,
      mapHeight: this.settings.mapSize,
      cloudMapId: cloud?.id ?? null,
      mapLabel: cloud ? cloud.name : `${MAP_TYPE_LABELS[this.settings.mapType]} ${sizeLabel}`,
      balance: balance ?? null,
      seats: players
        .slice(0, MAX_SEATS)
        .map((p) => ({ userId: p.userId, username: p.username, faction: p.faction })),
    };
    void this.channel?.send({ type: 'broadcast', event: 'start', payload });
    return null;
  }

  private handleStart(payload: StartPayload): void {
    if (this.started || this.closed) return;
    if (payload.version !== NET_VERSION) {
      this.close('Versionen passen nicht zusammen — bitte beide Seiten neu laden.');
      return;
    }
    const localSeat = payload.seats.findIndex((s) => s.userId === this.self.userId);
    if (localSeat === -1) {
      this.close('Partie wurde ohne dich gestartet.');
      return;
    }
    this.started = true;
    const match: MatchStart = {
      code: this.code,
      seed: payload.seed,
      seats: payload.seats.map((s) => ({ faction: s.faction, name: s.username })),
      localSeat,
      mapType: payload.mapType,
      mapWidth: payload.mapWidth,
      mapHeight: payload.mapHeight,
      cloudMapId: payload.cloudMapId ?? undefined,
      mapLabel: payload.mapLabel,
      balance: payload.balance ?? undefined,
    };
    // The lobby channel is done — the match runs on cac:game:<CODE>.
    void this.leave();
    this.events.onStart(match);
  }

  private close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    void this.leave();
    this.events.onClosed(reason);
  }

  async leave(): Promise<void> {
    const ch = this.channel;
    this.channel = null;
    if (ch) await getSupabase()?.removeChannel(ch);
  }
}
