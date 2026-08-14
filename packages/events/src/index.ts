import { connect, type NatsConnection } from 'nats';
import type { GameEvent, GameState } from '@ludo/shared';

export const STREAM_NAME = 'LUDO';
export const SUBJECT_PREFIX = 'ludo.game';

export interface GameEnvelope {
  readonly gameId: string;
  readonly version: number;
  readonly events: readonly GameEvent[];
  readonly state: GameState;
  readonly correlationId: string;
  readonly emittedAt: number;
}

export interface EventBus {
  publish(envelope: GameEnvelope): Promise<void>;
  /** Drives the readiness probe. A disconnected bus means no live updates. */
  isConnected(): boolean;
  close(): Promise<void>;
}

export interface BusLogger {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

/**
 * Connects in the background and keeps retrying with capped backoff.
 *
 * Pods start in arbitrary order, so this service will regularly boot before
 * NATS accepts connections. Crashing would crash-loop; giving up would leave a
 * process that looks healthy while silently emitting nothing. So we retry
 * forever and report the truth through `isConnected`, which the readiness
 * probe uses to withhold traffic until the bus is genuinely live.
 */
export function createBus(servers: string, name: string, logger: BusLogger): EventBus {
  let nc: NatsConnection | null = null;
  let closed = false;
  let attempt = 0;

  async function ensureStream(connection: NatsConnection): Promise<void> {
    const jsm = await connection.jetstreamManager();
    try {
      await jsm.streams.add({
        name: STREAM_NAME,
        subjects: [`${SUBJECT_PREFIX}.>`],
        max_age: 60 * 60 * 1_000_000_000, // one hour, in nanoseconds
      });
    } catch {
      // Already exists — the normal restart path.
    }
  }

  async function dial(): Promise<void> {
    while (!closed && nc === null) {
      try {
        const connection = await connect({
          servers,
          name,
          reconnect: true,
          maxReconnectAttempts: -1,
        });
        await ensureStream(connection);
        nc = connection;
        attempt = 0;
        logger.info({ servers }, 'connected to NATS JetStream');

        connection.closed().then(() => {
          if (closed) return;
          logger.error({}, 'NATS connection closed, redialing');
          nc = null;
          void dial();
        });
        return;
      } catch (err) {
        attempt += 1;
        const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
        logger.warn({ attempt, delay }, 'NATS connect failed, retrying');
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  void dial();

  const encoder = new TextEncoder();
  return {
    async publish(envelope) {
      if (!nc) throw new Error('event_bus_unavailable');
      await nc.jetstream().publish(
        `${SUBJECT_PREFIX}.${envelope.gameId}`,
        encoder.encode(JSON.stringify(envelope)),
      );
    },
    isConnected: () => nc !== null && !nc.isClosed(),
    async close() {
      closed = true;
      if (nc) await nc.drain();
    },
  };
}

/** Subscribes to every game's events, redialing on loss. */
export function subscribeEvents(
  servers: string,
  name: string,
  logger: BusLogger,
  onEnvelope: (envelope: GameEnvelope) => void,
): { isConnected: () => boolean; close: () => Promise<void> } {
  let nc: NatsConnection | null = null;
  let closed = false;
  let attempt = 0;
  const decoder = new TextDecoder();

  async function dial(): Promise<void> {
    while (!closed && nc === null) {
      try {
        const connection = await connect({
          servers,
          name,
          reconnect: true,
          maxReconnectAttempts: -1,
        });
        nc = connection;
        attempt = 0;
        logger.info({ servers }, 'subscribed to game events');

        connection.closed().then(() => {
          if (closed) return;
          logger.error({}, 'NATS connection closed, redialing');
          nc = null;
          void dial();
        });

        void (async () => {
          for await (const msg of connection.subscribe(`${SUBJECT_PREFIX}.*`)) {
            try {
              onEnvelope(JSON.parse(decoder.decode(msg.data)) as GameEnvelope);
            } catch (err) {
              logger.error({ err }, 'malformed event envelope');
            }
          }
        })();
        return;
      } catch (err) {
        attempt += 1;
        const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
        logger.warn({ attempt, delay }, 'NATS connect failed, retrying');
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  void dial();

  return {
    isConnected: () => nc !== null && !nc.isClosed(),
    async close() {
      closed = true;
      if (nc) await nc.drain();
    },
  };
}
