import { useCallback, useEffect } from 'react';
import { SignIn } from '@/screens/SignIn';
import { Lobby } from '@/screens/Lobby';
import { Game } from '@/screens/Game';
import { useSession } from '@/store/session';
import { useRoom } from '@/store/room';
import { useGame } from '@/store/game';

export default function App() {
  const token = useSession((s) => s.token);
  const leaveRoom = useRoom((s) => s.leave);
  const joinError = useGame((s) => s.joinError);
  const gameId = useGame((s) => s.gameId);
  const connect = useGame((s) => s.connect);
  const disconnect = useGame((s) => s.disconnect);
  const joinGame = useGame((s) => s.joinGame);
  const reset = useGame((s) => s.reset);

  useEffect(() => {
    if (token) connect(token);
    return () => {
      if (!token) disconnect();
    };
  }, [token, connect, disconnect]);

  // A game that cannot be joined is usually one that has expired. Clear the
  // stored room so the lobby does not send us straight back into it.
  useEffect(() => {
    if (joinError) leaveRoom();
  }, [joinError, leaveRoom]);

  const onGameReady = useCallback(
    (id: string) => {
      if (id !== gameId) joinGame(id);
    },
    [gameId, joinGame],
  );

  const onLeave = useCallback(() => {
    reset();
    leaveRoom();
  }, [reset, leaveRoom]);

  if (!token) return <SignIn />;
  if (!gameId) return <Lobby onGameReady={onGameReady} />;
  return <Game onLeave={onLeave} />;
}