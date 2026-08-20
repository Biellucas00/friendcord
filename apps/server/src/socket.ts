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
  io.on("connection", async (socket) => {
    const tokenUser = socket.data.user as AuthUser;
    const fresh = await query<any>(`SELECT id,username,display_name AS "displayName",site_role AS "siteRole",CASE WHEN avatar_id IS NULL THEN NULL ELSE '/api/attachments/'||avatar_id END AS "avatarUrl" FROM users WHERE id=$1`, [tokenUser.id]);
    const user = (fresh.rows[0] ?? tokenUser) as AuthUser; socket.data.user = user;
    const entry = online.get(user.id) ?? { user, sockets: new Set<string>() }; entry.user = user; entry.sockets.add(socket.id); online.set(user.id, entry); publishPresence();
    socket.on("channel:join", async (channelId) => { const allowed = await query("SELECT 1 FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE c.id=$1 AND m.user_id=$2", [channelId, user.id]); if (allowed.rowCount) socket.join(`channel:${channelId}`); });
    socket.on("message:send", async ({ channelId, body, attachmentId }) => {
      const clean = body.trim().slice(0, 2000); if (!clean && !attachmentId) return;
      const result = await query<any>(`INSERT INTO messages(channel_id,author_id,body,attachment_id)
        SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE c.id=$1 AND m.user_id=$2)
        AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM attachments WHERE id=$4 AND uploaded_by=$2))
        RETURNING id,channel_id AS "channelId",coalesce(body,'') AS body,created_at AS "createdAt"`, [channelId, user.id, clean, attachmentId ?? null]);
      if (!result.rows[0]) return; let attachment = null;
      if (attachmentId) { const file = await query<any>("SELECT id,filename,mime_type AS \"mimeType\",size_bytes AS \"sizeBytes\" FROM attachments WHERE id=$1", [attachmentId]); if (file.rows[0]) attachment = { ...file.rows[0], url: `/api/attachments/${attachmentId}` }; }
      io.to(`channel:${channelId}`).emit("message:new", { ...result.rows[0], author: user, attachment });
    });
    socket.on("call:join", async (channelId) => { const allowed = await query("SELECT 1 FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE c.id=$1 AND c.kind='voice' AND m.user_id=$2 AND (m.role IN ('owner','admin') OR NOT EXISTS(SELECT 1 FROM channel_access ca WHERE ca.channel_id=c.id) OR EXISTS(SELECT 1 FROM channel_access ca WHERE ca.channel_id=c.id AND ca.user_id=$2))", [channelId, user.id]); if (!allowed.rowCount) return; const room = `call:${channelId}`; const peers = await io.in(room).fetchSockets(); socket.join(room); for (const peer of peers) { peer.emit("webrtc:peer-joined", { socketId: socket.id, user }); if (peer.data.callState) socket.emit("call:state", { socketId: peer.id, user: peer.data.user as AuthUser, ...peer.data.callState }); } socket.data.callChannelId = channelId; socket.data.callState = { audioEnabled: true, videoEnabled: false, screenSharing: false }; socket.to(room).emit("call:state", { socketId: socket.id, user, ...socket.data.callState }); });
    socket.on("call:leave", (channelId) => { socket.leave(`call:${channelId}`); socket.to(`call:${channelId}`).emit("webrtc:peer-left", { socketId: socket.id }); });
    socket.on("call:state", ({ channelId, audioEnabled, videoEnabled, screenSharing }) => { if (!socket.rooms.has(`call:${channelId}`)) return; socket.data.callState = { audioEnabled, videoEnabled, screenSharing }; socket.to(`call:${channelId}`).emit("call:state", { socketId: socket.id, user, audioEnabled, videoEnabled, screenSharing }); });
    socket.on("webrtc:signal", ({ target, signal }) => io.to(target).emit("webrtc:signal", { from: socket.id, signal }));
    socket.on("media:update", ({ channelId, state }) => socket.to(`channel:${channelId}`).emit("media:state", state));
    socket.on("disconnecting", () => { for (const room of socket.rooms) if (room.startsWith("call:")) socket.to(room).emit("webrtc:peer-left", { socketId: socket.id }); });
    socket.on("disconnect", () => { const current = online.get(user.id); current?.sockets.delete(socket.id); if (!current?.sockets.size) online.delete(user.id); publishPresence(); });
  }); return io;
}
