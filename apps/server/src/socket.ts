import type { Server } from "http";
import { Server as SocketServer } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@friendcord/shared";
import { config } from "./config.js";
import { query } from "./db.js";
import { readToken, type AuthUser } from "./auth.js";

const online = new Map<string, { user: AuthUser; sockets: Set<string> }>();
export function attachSocket(server: Server) {
  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(server, { cors: { origin: config.CLIENT_ORIGIN } });
  io.use((socket, next) => { try { socket.data.user = readToken(socket.handshake.auth.token); next(); } catch { next(new Error("Não autenticado")); } });
  const publishPresence = () => io.emit("presence:update", [...online.values()].map(({ user }) => ({ ...user, online: true })));
  io.on("connection", (socket) => {
    const user = socket.data.user as AuthUser; const entry = online.get(user.id) ?? { user, sockets: new Set<string>() }; entry.sockets.add(socket.id); online.set(user.id, entry); publishPresence();
    socket.on("channel:join", async (channelId) => { const allowed = await query("SELECT 1 FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE c.id=$1 AND m.user_id=$2", [channelId, user.id]); if (allowed.rowCount) socket.join(`channel:${channelId}`); });
    socket.on("message:send", async ({ channelId, body }) => { const clean = body.trim().slice(0, 2000); if (!clean) return; const result = await query<any>("INSERT INTO messages(channel_id,author_id,body) SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE c.id=$1 AND m.user_id=$2) RETURNING id,channel_id AS \"channelId\",body,created_at AS \"createdAt\"", [channelId, user.id, clean]); if (result.rows[0]) io.to(`channel:${channelId}`).emit("message:new", { ...result.rows[0], author: user }); });
    socket.on("call:join", async (channelId) => { const allowed = await query("SELECT 1 FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE c.id=$1 AND c.kind='voice' AND m.user_id=$2", [channelId, user.id]); if (!allowed.rowCount) return; const room = `call:${channelId}`; const peers = await io.in(room).fetchSockets(); socket.join(room); for (const peer of peers) { peer.emit("webrtc:peer-joined", { socketId: socket.id, user }); } });
    socket.on("call:leave", (channelId) => { socket.leave(`call:${channelId}`); socket.to(`call:${channelId}`).emit("webrtc:peer-left", { socketId: socket.id }); });
    socket.on("webrtc:signal", ({ target, signal }) => io.to(target).emit("webrtc:signal", { from: socket.id, signal }));
    socket.on("media:update", ({ channelId, state }) => socket.to(`channel:${channelId}`).emit("media:state", state));
    socket.on("disconnecting", () => { for (const room of socket.rooms) if (room.startsWith("call:")) socket.to(room).emit("webrtc:peer-left", { socketId: socket.id }); });
    socket.on("disconnect", () => { const current = online.get(user.id); current?.sockets.delete(socket.id); if (!current?.sockets.size) online.delete(user.id); publishPresence(); });
  }); return io;
}
