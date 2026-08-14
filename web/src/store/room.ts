import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface RoomStore {
  code: string | null;
  seatIndex: number | null;
  setRoom: (code: string, seatIndex: number | null) => void;
  leave: () => void;
}

const FRESH = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('fresh');

export const useRoom = create<RoomStore>()(
  persist(
    (set) => ({
      code: null,
      seatIndex: null,
      setRoom: (code, seatIndex) => set({ code, seatIndex }),
      leave: () => set({ code: null, seatIndex: null }),
    }),
    {
      name: 'ludo-room',
      // Matches the session store: a fresh tab must not inherit a room either.
      storage: createJSONStorage(() => (FRESH ? sessionStorage : localStorage)),
    },
  ),
);