"use strict";

const crypto = require("crypto");
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const TOTAL_TICKETS = 450;
const MAX_TICKETS_PER_PLAYER = 2;
const BUY_SECONDS = Number(process.env.BUY_SECONDS || 20);
const CALL_INTERVAL_MS = Number(process.env.CALL_INTERVAL_MS || 5000);
const FIRST_BALL_DELAY_MS = Number(process.env.FIRST_BALL_DELAY_MS || 1200);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const SEED_SOLD_TICKETS = [366, 367, 372, 388, 389, 398, 412, 414, 428, 429, 444, 448, 449, 450];

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

function randomUnique(count, min, max) {
  const pool = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
function createTicket(id) {
  const columns = [[1,15],[16,30],[31,45],[46,60],[61,75]].map(([min,max]) => randomUnique(5,min,max));
  const numbers = [];
  for (let row = 0; row < 5; row += 1) for (let col = 0; col < 5; col += 1) numbers.push(columns[col][row]);
  numbers[12] = "FREE";
  return { id, numbers };
}
const tickets = Array.from({ length: TOTAL_TICKETS }, (_, i) => createTicket(i + 1));
const reservations = new Map();
let sold = new Set(SEED_SOLD_TICKETS);
let game = { number: 1, phase: "buying", timeLeft: BUY_SECONDS, called: [], current: null, winners: [] };
let buyingTimer, nextBallTimer, firstBallTimer, nextRoundTimer;
function letter(n) { return ["B","I","N","G","O"][Math.floor((n - 1) / 15)]; }
function clearTimers() {
  clearInterval(buyingTimer); clearTimeout(nextBallTimer); clearTimeout(firstBallTimer); clearTimeout(nextRoundTimer);
  buyingTimer = nextBallTimer = firstBallTimer = nextRoundTimer = undefined;
}
function publicState() {
  return { gameNumber: game.number, phase: game.phase, timeLeft: game.timeLeft, called: game.called, current: game.current,
    sold: [...sold].sort((a,b) => a-b), available: TOTAL_TICKETS - sold.size, players: reservations.size, winners: game.winners };
}
function emitState() { io.emit("state", publicState()); }
function sendPrivateTickets(socket) {
  const ids = reservations.get(socket.data.playerId) || [];
  socket.emit("ticket_cards", tickets.filter((ticket) => ids.includes(ticket.id)));
}
function startBuying({ incrementGame = false } = {}) {
  clearTimers(); if (incrementGame) game.number += 1;
  reservations.clear(); sold = new Set(SEED_SOLD_TICKETS);
  game = { number: game.number, phase: "buying", timeLeft: BUY_SECONDS, called: [], current: null, winners: [] };
  emitState();
  buyingTimer = setInterval(() => {
    if (game.phase !== "buying") return;
    game.timeLeft -= 1; emitState();
    if (game.timeLeft <= 0) beginGame();
  }, 1000);
}
function beginGame() {
  if (game.phase !== "buying") return;
  clearTimers(); game.phase = "playing"; game.timeLeft = 0; emitState();
  firstBallTimer = setTimeout(callNextBall, FIRST_BALL_DELAY_MS);
}
function callNextBall() {
  if (game.phase !== "playing") return;
  const remaining = Array.from({ length: 75 }, (_, i) => i + 1).filter((n) => !game.called.includes(n));
  if (!remaining.length) return finishGame();
  const number = remaining[crypto.randomInt(remaining.length)];
  game.called.push(number); game.current = { number, letter: letter(number), display: `${letter(number)}-${number}` };
  io.emit("ball_called", game.current); emitState(); nextBallTimer = setTimeout(callNextBall, CALL_INTERVAL_MS);
}
function finishGame() {
  if (game.phase !== "playing") return;
  clearTimers(); game.phase = "finished"; emitState();
  io.emit("game_finished", { gameNumber: game.number, winners: game.winners });
  nextRoundTimer = setTimeout(() => startBuying({ incrementGame: true }), 4000);
}
function winningPattern(ticket) {
  const marked = ticket.numbers.map((value) => value === "FREE" || game.called.includes(value));
  const line = [0,1,2,3,4].some((row) => marked.slice(row * 5, row * 5 + 5).every(Boolean)) ||
    [0,1,2,3,4].some((col) => [0,1,2,3,4].every((row) => marked[row * 5 + col]));
  if (line) return "5-IN-A-ROW";
  return [0,4,20,24].every((i) => marked[i]) ? "FOUR CORNERS" : null;
}
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN || req.get("authorization") === `Bearer ${ADMIN_TOKEN}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
}
app.get("/api/health", (req,res) => res.json({ ok: true, state: publicState() }));
app.get("/api/game", (req,res) => res.json(publicState()));
app.post("/api/admin/start", requireAdmin, (req,res) => { beginGame(); res.json({ ok: true, state: publicState() }); });
app.post("/api/admin/reset", requireAdmin, (req,res) => { game.number = 1; startBuying(); res.json({ ok: true, state: publicState() }); });
// Express 5 requires a named wildcard; a regular expression keeps this SPA fallback portable.
app.get(/.*/, (req,res) => res.sendFile(path.join(__dirname, "..", "frontend", "index.html")));
io.on("connection", (socket) => {
  // A browser keeps this anonymous id in local storage, so reconnecting does not lose its ticket.
  const proposedId = String(socket.handshake.auth?.playerId || "");
  socket.data.playerId = /^[a-zA-Z0-9_-]{12,80}$/.test(proposedId) ? proposedId : socket.id;
  socket.emit("state", publicState());
  sendPrivateTickets(socket);
  socket.on("preview_tickets", (payload = {}) => {
    if (game.phase !== "buying") return;
    const ids = [...new Set((payload.tickets || []).map(Number))]
      .filter((id) => Number.isInteger(id) && id >= 1 && id <= TOTAL_TICKETS)
      .slice(0, MAX_TICKETS_PER_PLAYER);
    socket.emit("ticket_previews", tickets.filter((ticket) => ids.includes(ticket.id)));
  });
  socket.on("reserve_tickets", (payload = {}) => {
    if (game.phase !== "buying") return socket.emit("ticket_error", "Ticket buying is closed.");
    const requested = [...new Set((payload.tickets || []).map(Number))].filter((id) => Number.isInteger(id) && id >= 1 && id <= TOTAL_TICKETS).slice(0, MAX_TICKETS_PER_PLAYER);
    if (!requested.length) return socket.emit("ticket_error", "Choose one or two valid tickets.");
    const old = reservations.get(socket.data.playerId) || [];
    old.forEach((id) => { if (!SEED_SOLD_TICKETS.includes(id)) sold.delete(id); });
    const unavailable = requested.filter((id) => sold.has(id));
    if (unavailable.length) { old.forEach((id) => sold.add(id)); return socket.emit("ticket_error", `Ticket ${unavailable.join(", ")} is already sold.`); }
    requested.forEach((id) => sold.add(id)); reservations.set(socket.data.playerId, requested);
    socket.emit("tickets_reserved", { tickets: requested }); sendPrivateTickets(socket); emitState();
  });
  socket.on("release_tickets", () => {
    if (game.phase !== "buying") return;
    const ids = reservations.get(socket.data.playerId) || [];
    ids.forEach((id) => { if (!SEED_SOLD_TICKETS.includes(id)) sold.delete(id); });
    reservations.delete(socket.data.playerId);
    socket.emit("tickets_reserved", { tickets: [] });
    emitState();
  });
  socket.on("claim_bingo", ({ ticketId } = {}) => {
    ticketId = Number(ticketId);
    if (game.phase !== "playing") return socket.emit("ticket_error", "The game is not active.");
    if (!reservations.get(socket.data.playerId)?.includes(ticketId)) return socket.emit("ticket_error", "That ticket is not yours.");
    if (game.winners.some((winner) => winner.ticketId === ticketId)) return;
    const pattern = winningPattern(tickets[ticketId - 1]);
    if (!pattern) return socket.emit("ticket_error", "That ticket does not have Bingo yet.");
    const winner = { ticketId, pattern }; game.winners.push(winner); io.emit("bingo_claimed", winner); finishGame();
  });
  // Reservations last only for the current buying round and survive a brief reconnect.
});
startBuying();
server.listen(PORT, () => console.log(`ZhaanBingo backend listening on http://localhost:${PORT}`));
