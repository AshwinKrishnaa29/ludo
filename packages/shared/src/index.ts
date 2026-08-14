/**
 * @ludo/shared - the single source of truth for the domain contract.
 *
 * Every service imports these types. Nothing in here may import from a
 * service: dependencies point inward only. This is what lets the game
 * engine, gateway and room service evolve independently.
 */

// ---------------------------------------------------------------------------
// Board geometry
// ---------------------------------------------------------------------------

/** Squares on the shared outer ring. */
export const MAIN_TRACK_LENGTH = 52;

/**
 * A token's journey is modelled as `progress`: the number of steps it has
 * taken since leaving the yard. This is *relative to its own colour*, which
 * removes almost all of the awkward modular arithmetic from the rules.
 *
 *   progress  0..51  -> on the shared outer ring
 *   progress 52..56  -> in this colour's private home column
 *   progress    57   -> HOME (the centre triangle)
 */
export const HOME_PROGRESS = 57;
export const HOME_COLUMN_ENTRY = 52;
export const TOKENS_PER_PLAYER = 4;

export const PLAYER_COLOURS = ['red', 'green', 'yellow', 'blue'] as const;
export type PlayerColour = (typeof PLAYER_COLOURS)[number];

/** Absolute ring square each colour enters the board on. */
export const START_OFFSET: Record<PlayerColour, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

/**
 * Squares where a token can never be captured: the four entry squares plus
 * the four star squares.
 */
export const SAFE_SQUARES: ReadonlySet<number> = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

/** Convert colour-relative progress to an absolute ring square. */
export function toAbsoluteSquare(colour: PlayerColour, progress: number): number | null {
  if (progress < 0 || progress >= HOME_COLUMN_ENTRY) return null;
  return (START_OFFSET[colour] + progress) % MAIN_TRACK_LENGTH;
}

/**
 * Colours for a table of `count` players when nobody has chosen.
 *
 * Two players are seated diagonally rather than side by side. Adjacent seats
 * are 13 squares apart, so red and green would spend the whole game within
 * capture range of each other's entry, while red and yellow start 26 apart -
 * a genuinely symmetric race.
 */
export function defaultColours(count: number): PlayerColour[] {
  if (count <= 2) return ['red', 'yellow'];
  if (count === 3) return ['red', 'green', 'yellow'];
  return ['red', 'green', 'yellow', 'blue'];
}

// ---------------------------------------------------------------------------
// Absence handling
// ---------------------------------------------------------------------------

/**
 * How many turns are played on behalf of a silent player before the table
 * stops and waits. Covering a few turns absorbs a tunnel or a locked phone;
 * covering the whole match would leave three people watching a bot.
 */
export const MISSED_TURNS_BEFORE_PAUSE = 3;

/** How long a paused game waits before the missing player is dropped. */
export const PAUSE_GRACE_MS = 60_000;

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type TokenZone = 'yard' | 'track' | 'home_column' | 'home';

export interface Token {
  readonly id: number;
  /** `null` while the token is still in the yard. */
  readonly progress: number | null;
}

export interface Player {
  readonly userId: string;
  readonly displayName: string;
  readonly colour: PlayerColour;
  readonly tokens: readonly Token[];
  readonly connected: boolean;
  /** Consecutive turns auto-played because the player timed out. */
  readonly missedTurns: number;
  readonly finishedRank: number | null;
  /** Dropped from the game. Their tokens are off the board for good. */
  readonly abandoned: boolean;
}

export type GamePhase =
  | 'awaiting_roll'
  | 'awaiting_move'
  | 'paused'
  | 'finished';

export interface GameState {
  readonly gameId: string;
  readonly roomId: string;
  readonly phase: GamePhase;
  readonly players: readonly Player[];
  /** Index into `players`. */
  readonly turnIndex: number;
  /** The roll awaiting a move, or `null` in `awaiting_roll`. */
  readonly pendingRoll: number | null;
  /** Consecutive sixes by the current player; three forfeits the turn. */
  readonly consecutiveSixes: number;
  /** Monotonic, incremented on every applied command. Used for ordering. */
  readonly version: number;
  /**
   * Epoch ms after which the current turn is auto-played. While paused this
   * is the moment the missing player is dropped instead, which lets one timer
   * drive both without a second deadline index.
   */
  readonly turnDeadline: number;
  /** Who the table is waiting for, when `phase` is `paused`. */
  readonly pausedFor: string | null;
  /** Command ids already applied - makes command handling idempotent. */
  readonly appliedCommands: readonly string[];
  readonly winnerOrder: readonly string[];
}

// ---------------------------------------------------------------------------
// Commands (client -> engine)
// ---------------------------------------------------------------------------

interface CommandBase {
  /** Client-generated UUID. Replaying the same id is a safe no-op. */
  readonly commandId: string;
  readonly userId: string;
  readonly issuedAt: number;
}

export interface RollDiceCommand extends CommandBase {
  readonly type: 'roll_dice';
}

export interface MoveTokenCommand extends CommandBase {
  readonly type: 'move_token';
  readonly tokenId: number;
}

/** Emitted by the turn-timer, not by a client. */
export interface AutoPlayCommand extends CommandBase {
  readonly type: 'auto_play';
}

export interface SetConnectionCommand extends CommandBase {
  readonly type: 'set_connection';
  readonly connected: boolean;
}

/**
 * Drops a player from the game. Emitted by the timer once the pause window
 * expires, or by the remaining players choosing to carry on without them.
 */
export interface AbandonPlayerCommand extends CommandBase {
  readonly type: 'abandon_player';
  readonly targetUserId: string;
}

export type GameCommand =
  | RollDiceCommand
  | MoveTokenCommand
  | AutoPlayCommand
  | SetConnectionCommand
  | AbandonPlayerCommand;

// ---------------------------------------------------------------------------
// Events (engine -> everyone)
// ---------------------------------------------------------------------------

export interface DiceRolledEvent {
  readonly type: 'dice_rolled';
  readonly userId: string;
  readonly value: number;
  /** Proof the server did not fabricate the roll after seeing the board. */
  readonly rollProof: RollProof;
}

export interface TokenMovedEvent {
  readonly type: 'token_moved';
  readonly userId: string;
  readonly tokenId: number;
  readonly from: number | null;
  readonly to: number;
}

export interface TokenCapturedEvent {
  readonly type: 'token_captured';
  readonly byUserId: string;
  readonly victimUserId: string;
  readonly tokenId: number;
}

export interface TokenHomeEvent {
  readonly type: 'token_home';
  readonly userId: string;
  readonly tokenId: number;
}

export interface TurnPassedEvent {
  readonly type: 'turn_passed';
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly reason: 'no_legal_move' | 'move_complete' | 'three_sixes' | 'timeout';
}

export interface ExtraTurnEvent {
  readonly type: 'extra_turn';
  readonly userId: string;
  readonly reason: 'rolled_six' | 'capture' | 'token_home';
}

export interface PlayerFinishedEvent {
  readonly type: 'player_finished';
  readonly userId: string;
  readonly rank: number;
}

export interface GameFinishedEvent {
  readonly type: 'game_finished';
  readonly winnerOrder: readonly string[];
}

export interface ConnectionChangedEvent {
  readonly type: 'connection_changed';
  readonly userId: string;
  readonly connected: boolean;
}

export interface GamePausedEvent {
  readonly type: 'game_paused';
  readonly userId: string;
  /** Epoch ms after which the player is dropped. */
  readonly resumeBy: number;
}

export interface GameResumedEvent {
  readonly type: 'game_resumed';
  readonly userId: string;
}

export interface PlayerAbandonedEvent {
  readonly type: 'player_abandoned';
  readonly userId: string;
  /**
   * `left` is a deliberate exit and is final - the seat cannot be reclaimed.
   * `timed_out` is the pause window expiring, `removed` is the rest of the
   * table deciding to carry on without someone.
   */
  readonly reason: 'left' | 'timed_out' | 'removed';
}

export type GameEvent =
  | DiceRolledEvent
  | TokenMovedEvent
  | TokenCapturedEvent
  | TokenHomeEvent
  | TurnPassedEvent
  | ExtraTurnEvent
  | PlayerFinishedEvent
  | GameFinishedEvent
  | ConnectionChangedEvent
  | GamePausedEvent
  | GameResumedEvent
  | PlayerAbandonedEvent;

// ---------------------------------------------------------------------------
// Provable dice
// ---------------------------------------------------------------------------

/**
 * Commit-reveal fairness. Before the game the server publishes
 * `sha256(serverSeed)`. Each roll is derived from `serverSeed:nonce`, and the
 * seed is revealed when the game ends, so any player can recompute every roll
 * and verify the server never re-rolled to its own advantage.
 */
export interface RollProof {
  readonly nonce: number;
  readonly serverSeedHash: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type RejectionReason =
  | 'not_your_turn'
  | 'wrong_phase'
  | 'unknown_player'
  | 'illegal_move'
  | 'game_paused'
  | 'game_finished';

export class CommandRejected extends Error {
  constructor(readonly reason: RejectionReason) {
    super(reason);
    this.name = 'CommandRejected';
  }
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export function zoneOf(progress: number | null): TokenZone {
  if (progress === null) return 'yard';
  if (progress >= HOME_PROGRESS) return 'home';
  if (progress >= HOME_COLUMN_ENTRY) return 'home_column';
  return 'track';
}

export function isFinished(player: Player): boolean {
  return player.tokens.every((t) => zoneOf(t.progress) === 'home');
}

/** Players still racing: not finished, not dropped. */
export function activePlayers(state: GameState): readonly Player[] {
  return state.players.filter((p) => p.finishedRank === null && !p.abandoned);
}