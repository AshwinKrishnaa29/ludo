# @ludo/web - Stage 3 client

Vite + React 19 + TypeScript. Zustand holds server-pushed game state, Tailwind v4
handles layout, Framer Motion animates tokens and dice. The board is hand-written
SVG on a 15x15 grid, driven entirely by the geometry constants in `@ludo/shared`
so the client and the engine can never disagree about where a token is.

## Running

From the repository root, with the services already running (`npm run dev`):

    npm run web:dev

Then open http://localhost:4000.

The dev server proxies `/sessions`, `/rooms`, `/games` and `/socket.io` to the
gateway on 4004, and `/graphql` to the BFF on 4005. The browser therefore only
ever sees one origin - no CORS, no cross-site cookies, and the same routing
shape an ingress provides in production.

## Production build

    npm run web:build

Output goes to `services/gateway/public`, which the gateway already serves.
After building, the real client is at http://localhost:4004 with no dev server
involved - that is the closest local equivalent to a deployed environment.

## Testing with several players

Each browser tab keeps its own identity because the session is held in
`sessionStorage` rather than `localStorage`. Four tabs in the same window are
four different players.

## Layout

The board is a single SVG with a `viewBox`, so it scales to any screen without
media queries. Only the surrounding chrome changes: player cards sit in a
two-column strip above the board on phones and in a single column beside it on
laptops.