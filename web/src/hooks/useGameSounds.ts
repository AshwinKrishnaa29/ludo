import useSound from 'use-sound';

export function useGameSounds() {
  const [playDice] = useSound('/sounds/dice-roll.wav', { volume: 0.6 });
  const [playMove] = useSound('/sounds/token-move.wav', { volume: 0.5 });
  const [playFlash] = useSound('/sounds/message.mp3', { volume: 0.7 });
  return { playDice, playMove, playFlash };
}