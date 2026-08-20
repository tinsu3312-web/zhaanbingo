# ZhaanBingo v7 — Backend Edition

This starts from the supplied working ZhaanBingo v7 frontend.

The visual layout and ticket/card UI are preserved. The backend adds:
- Express static hosting
- Socket.IO live game state
- Server-controlled 20 second buying countdown
- Server-controlled 75-ball drawing
- Live called-ball updates
- Ticket reservation/availability
- Basic admin start/reset endpoints

Run from `backend`:
`npm.cmd install`
`npm.cmd start`

Then open `http://localhost:3000`.

Do not open `frontend/index.html` directly; the page must be served by the Node server so Socket.IO works.
