# ZhaanBingo

The application is served by the Node backend and uses Socket.IO for its live game state.

## Run locally

1. Open a terminal in `backend`.
2. Run `npm install` once.
3. Run `npm start`.
4. Open `http://localhost:3000`.

Do not open `frontend/index.html` directly; the live game connection requires the backend.

## Backend features

- Server-owned 450-ticket pool and standard 75-ball ticket cards
- Live, shared buying countdown and ball drawing
- Per-connection ticket reservations, released when a buyer disconnects
- Server-side validation of Bingo claims (rows, columns, or four corners)
- Read-only status endpoints: `/api/health` and `/api/game`
- Admin controls: `POST /api/admin/start` and `POST /api/admin/reset`

Set `ADMIN_TOKEN` from `backend/.env.example` before deploying. Send it as a Bearer token when calling either admin endpoint. The server intentionally leaves these endpoints open only when no token has been configured, for simple local development.

This version keeps game state in memory. Restarting the server begins a fresh game; use a database and authenticated user accounts before production deployment.
