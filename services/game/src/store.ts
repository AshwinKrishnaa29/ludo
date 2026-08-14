import type { Redis } from 'ioredis';
import type { GameState } from '@ludo/shared';

const KEY_PREFIX = 'game:';
const SEED_PREFIX = 'seed:';
const NONCE_PREFIX = 'nonce:';
const DEADLINE_ZSET = 'games:deadlines';

/** Live games expire a day after their last write; finished games sooner. */
const ACTIVE_TTL_SECONDS = 60 * 60 * 24;
const FINISHED_TTL_SECONDS = 60 * 10;

export class VersionConflict extends Error {
  constructor() {
    super('version_conflict');
    this.name = 'VersionConflict';
  }
}

/**
 * Game state lives in Redis, never in process memory. That is the whole reason
 * a gateway or engine pod can be killed mid-match without losing the game —
 * any replica can pick up the next command.
 *
 * Writes are guarded by an optimistic version check executed inside a Lua
 * script, so two commands racing on the same game cannot both win.
 */
export class GameStore {
  constructor(private readonly redis: Redis) {
    this.redis.defineCommand('saveGame', {
      numberOfKeys: 2,
      lua: `
        local current = redis.call('GET', KEYS[1])
        if current then
          local decoded = cjson.decode(current)
          if tonumber(decoded.version) ~= tonumber(ARGV[2]) then
            return redis.error_reply('version_conflict')
          end
        elseif tonumber(ARGV[2]) ~= -1 then
          return redis.error_reply('version_conflict')
        end
        redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
        if tonumber(ARGV[5]) == 1 then
          redis.call('ZREM', KEYS[2], ARGV[4])
        else
          redis.call('ZADD', KEYS[2], ARGV[6], ARGV[4])
        end
        return 1
      `,
    });
  }

  async load(gameId: string): Promise<GameState | null> {
    const raw = await this.redis.get(KEY_PREFIX + gameId);
    return raw ? (JSON.parse(raw) as GameState) : null;
  }

  /**
   * @param expectedVersion the version read before applying the command, or
   *        -1 when creating a game that must not already exist.
   */
  async save(state: GameState, expectedVersion: number): Promise<void> {
    const finished = state.phase === 'finished';
    try {
      await (this.redis as unknown as {
        saveGame(...args: (string | number)[]): Promise<number>;
      }).saveGame(
        KEY_PREFIX + state.gameId,
        DEADLINE_ZSET,
        JSON.stringify(state),
        expectedVersion,
        finished ? FINISHED_TTL_SECONDS : ACTIVE_TTL_SECONDS,
        state.gameId,
        finished ? 1 : 0,
        state.turnDeadline,
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('version_conflict')) {
        throw new VersionConflict();
      }
      throw err;
    }
  }

  /** Games whose turn timer has expired, oldest first. */
  async expiredGames(now: number, limit = 50): Promise<string[]> {
    return this.redis.zrangebyscore(DEADLINE_ZSET, '-inf', now, 'LIMIT', 0, limit);
  }

  async putSeed(gameId: string, seed: string): Promise<void> {
    await this.redis.set(SEED_PREFIX + gameId, seed, 'EX', ACTIVE_TTL_SECONDS);
  }

  async getSeed(gameId: string): Promise<string | null> {
    return this.redis.get(SEED_PREFIX + gameId);
  }

  /** Atomically reserves the next dice nonce for this game. */
  async nextNonce(gameId: string): Promise<number> {
    const key = NONCE_PREFIX + gameId;
    const value = await this.redis.incr(key);
    if (value === 1) await this.redis.expire(key, ACTIVE_TTL_SECONDS);
    return value - 1;
  }
}
