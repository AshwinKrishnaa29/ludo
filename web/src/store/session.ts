import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { post } from '@/lib/api';

interface GuestResponse {
  token: string;
  userId: string;
  displayName: string;
}

interface SessionStore {
  token: string | null;
  userId: string | null;
  displayName: string | null;
  error: string | null;
  busy: boolean;
  signIn: (displayName: string) => Promise<void>;
  signOut: () => void;
}

/**
 * Identity is kept in localStorage so closing the tab does not lose your seat
 * - coming back later, on the same browser, you are still you.
 *
 * `?fresh=1` forces a brand new guest, which is how several players can be
 * driven from one browser during local testing. Without it, every tab in a
 * browser now shares one identity, which is correct for real players and
 * inconvenient for exactly one person: you.
 */
const FRESH = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('fresh');

export const useSession = create<SessionStore>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      displayName: null,
      error: null,
      busy: false,

      async signIn(displayName) {
        set({ busy: true, error: null });
        try {
          const data = await post<GuestResponse>('/sessions/guest', {
            displayName: displayName.trim() || undefined,
          });
          set({
            token: data.token,
            userId: data.userId,
            displayName: data.displayName,
            busy: false,
          });
        } catch (err) {
          set({ busy: false, error: (err as Error).message });
        }
      },

      signOut: () => set({ token: null, userId: null, displayName: null }),
    }),
    {
      name: FRESH ? `ludo-session-fresh-${Math.random().toString(36).slice(2, 8)}` : 'ludo-session',
      storage: createJSONStorage(() => (FRESH ? sessionStorage : localStorage)),
    },
  ),
);