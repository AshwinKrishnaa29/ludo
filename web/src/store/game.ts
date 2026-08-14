// web/src/store/game.ts
// Zustand store — no JSX, no React components here.

import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import type { GameEvent, GameState } from '@ludo/shared';
import { get } from '@/lib/api';

interface Envelope {
  gameId: string;
  version: number;
  state: GameState;
  events: GameEvent[];
}

interface Snapshot {
  state: GameState;
  legalTokenIds: number[];
}

export interface LastRoll {
  userId: string;
  value: number;
  seq: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  text: string;
  at: number;
}

// Exported so EndScreen, PlayerSeat and titles.ts can all import from one place
export interface PlayerStats {
  captures: number;
  sixes: number;
  tokensHome: number;
  gotCaptured: number;
}

interface GameStore {
  socket: Socket | null;
  connected: boolean;
  gameId: string | null;
  state: GameState | null;
  legal: number[];
  lastEvents: GameEvent[];
  lastRoll: LastRoll | null;
  rejection: string | null;
  joinError: string | null;
  rolls: number[];
  serverSeedHash: string | null;
  chat: ChatMessage[];
  unread: number;
  selfUserId: string | null;
  stats: Record<string, PlayerStats>;

  connect: (token: string) => void;
  disconnect: () => void;
  joinGame: (gameId: string) => void;
  roll: () => void;
  move: (tokenId: number) => void;
  say: (text: string) => void;
  abandon: (targetUserId: string) => void;
  leaveGame: () => void;
  setSelf: (userId: string | null) => void;
  reset: () => void;
}

let seq = 0;

function blankStats(): PlayerStats {
  return { captures: 0, sixes: 0, tokensHome: 0, gotCaptured: 0 };
}

export const useGame = create<GameStore>((set, getState) => ({
  socket: null,
  connected: false,
  gameId: null,
  state: null,
  legal: [],
  lastEvents: [],
  lastRoll: null,
  rejection: null,
  joinError: null,
  rolls: [],
  serverSeedHash: null,
  chat: [],
  unread: 0,
  selfUserId: null,
  stats: {},

  setSelf: (userId) => set({ selfUserId: userId }),

  connect(token) {
    if (getState().socket) return;
    const socket = io({ auth: { token }, withCredentials: true });

    socket.on('connect', () => set({ connected: true }));
    socket.on('disconnect', () => set({ connected: false }));
    socket.on('connect_error', () => set({ connected: false }));

    socket.on('snapshot', (snap: Snapshot & { serverSeedHash?: string }) => {
      set({
        state: snap.state,
        legal: snap.legalTokenIds ?? [],
        lastEvents: [],
        serverSeedHash: snap.serverSeedHash ?? null,
      });
    });

    socket.on('game_update', async (env: Envelope) => {
      const rolled = env.events.find((e) => e.type === 'dice_rolled');

      // Update per-player stats from incoming events
      set((prev) => {
        const stats = { ...prev.stats };
        for (const ev of env.events) {
          if (ev.type === 'dice_rolled') {
            if (!stats[ev.userId]) stats[ev.userId] = blankStats();
            if (ev.value === 6) {
              stats[ev.userId] = { ...stats[ev.userId]!, sixes: stats[ev.userId]!.sixes + 1 };
            }
          }
          if (ev.type === 'token_captured') {
            if (!stats[ev.byUserId]) stats[ev.byUserId] = blankStats();
            if (!stats[ev.victimUserId]) stats[ev.victimUserId] = blankStats();
            stats[ev.byUserId] = { ...stats[ev.byUserId]!, captures: stats[ev.byUserId]!.captures + 1 };
            stats[ev.victimUserId] = { ...stats[ev.victimUserId]!, gotCaptured: stats[ev.victimUserId]!.gotCaptured + 1 };
          }
          if (ev.type === 'token_home') {
            if (!stats[ev.userId]) stats[ev.userId] = blankStats();
            stats[ev.userId] = { ...stats[ev.userId]!, tokensHome: stats[ev.userId]!.tokensHome + 1 };
          }
        }
        return { stats };
      });

      set({
        state: env.state,
        legal: [],
        lastEvents: env.events,
        rolls: rolled && rolled.type === 'dice_rolled'
          ? [...getState().rolls, rolled.value]
          : getState().rolls,
        ...(rolled && rolled.type === 'dice_rolled'
          ? { lastRoll: { userId: rolled.userId, value: rolled.value, seq: ++seq } }
          : {}),
      });
      await refreshLegal(set, getState);
    });

    socket.on('chat', (msg: ChatMessage) => {
      set((prev) => ({
        chat: [...prev.chat, msg],
        unread: prev.unread + 1,
      }));
    });

    set({ socket });
  },

  disconnect() {
    getState().socket?.close();
    set({ socket: null, connected: false });
  },

  joinGame(gameId) {
    const { socket, gameId: previous } = getState();
    if (!socket) return;
    if (previous !== gameId) {
      set({
        state: null,
        legal: [],
        lastEvents: [],
        lastRoll: null,
        rolls: [],
        serverSeedHash: null,
        chat: [],
        unread: 0,
        stats: {},
      });
    }
    set({ gameId, joinError: null });
    socket.emit('join_game', gameId, () => {
      void refreshLegal(set, getState);
    });
  },

  roll() {
    const { socket, gameId } = getState();
    if (!socket || !gameId) return;
    set({ rejection: null });
    socket.emit(
      'command',
      {
        gameId,
        command: {
          type: 'roll_dice',
          commandId: crypto.randomUUID(),
          issuedAt: Date.now(),
        },
      },
      (r: { ok: boolean; error?: string }) => {
        if (!r.ok) set({ rejection: r.error ?? 'rejected' });
      },
    );
  },

  move(tokenId) {
    const { socket, gameId } = getState();
    if (!socket || !gameId) return;
    set({ legal: [], rejection: null });
    socket.emit(
      'command',
      {
        gameId,
        command: {
          type: 'move_token',
          tokenId,
          commandId: crypto.randomUUID(),
          issuedAt: Date.now(),
        },
      },
      (r: { ok: boolean; error?: string }) => {
        if (!r.ok) set({ rejection: r.error ?? 'rejected' });
      },
    );
  },

  say(text) {
    const { socket, gameId } = getState();
    if (!socket || !gameId || !text.trim()) return;
    socket.emit('chat', { gameId, text: text.trim() });
  },

  abandon(targetUserId) {
    const { socket, gameId } = getState();
    if (!socket || !gameId) return;
    socket.emit('command', {
      gameId,
      command: {
        type: 'abandon_player',
        targetUserId,
        commandId: crypto.randomUUID(),
        issuedAt: Date.now(),
      },
    });
  },

  leaveGame() {
    const { socket, gameId, selfUserId } = getState();
    if (socket && gameId && selfUserId) {
      socket.emit('command', {
        gameId,
        command: {
          type: 'abandon_player',
          targetUserId: selfUserId,
          commandId: crypto.randomUUID(),
          issuedAt: Date.now(),
        },
      });
    }
  },

  reset() {
    set({
      gameId: null,
      state: null,
      legal: [],
      lastEvents: [],
      lastRoll: null,
      rejection: null,
      joinError: null,
      rolls: [],
      serverSeedHash: null,
      chat: [],
      unread: 0,
      stats: {},
    });
  },
}));

async function refreshLegal(
  set: (partial: Partial<GameStore>) => void,
  getState: () => GameStore,
): Promise<void> {
  const { gameId } = getState();
  if (!gameId) return;
  try {
    const snap = await get<Snapshot>(`/games/${gameId}`);
    set({ legal: snap.legalTokenIds ?? [] });
  } catch {
    set({ legal: [] });
  }
}