import type { Server } from "http";
import { Server as SocketServer } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@friendcord/shared";
import { config } from "./config.js";
import { query } from "./db.js";
import { readToken, type AuthUser } from "./auth.js";

const online = new Map<string, { user: AuthUser; sockets: Set<string> }>();
let activeIo: SocketServer<ClientToServerEvents, ServerToClientEvents> | null = null;
export async function notifyMemberJoined(roomId: string, userId: string) {
  const person = (await query<any>(`SELECT id,username,display_name AS "displayName",custom_status AS "customStatus",CASE WHEN avatar_id IS NULL THEN NULL ELSE '/api/attachments/'||avatar_id END AS "avatarUrl" FROM users WHERE id=$1`, [userId])).rows[0];
  if (!person) return;
  activeIo?.emit("room:member-joined", { roomId, user: person });
  const channel = (await query<{ id: string }>("SELECT id FROM channels WHERE room_id=$1 AND kind='text' ORDER BY created_at LIMIT 1", [roomId])).rows[0];
  if (!channel) return;
  const bot = (await query<any>("INSERT INTO users(username,display_name,password_hash,custom_status) VALUES('friendcord','FriendCord','DISABLED_SYSTEM_ACCOUNT','Sistema') ON CONFLICT(username) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id,username,display_name AS \"displayName\"", [])).rows[0];
  const message = (await query<any>("INSERT INTO messages(channel_id,author_id,body) VALUES($1,$2,$3) RETURNING id,channel_id AS \"channelId\",body,created_at AS \"createdAt\"", [channel.id, bot.id, `👋 @${person.username} entrou no servidor.`])).rows[0];
  activeIo?.to(`channel:${channel.id}`).emit("message:new", { ...message, author: bot, attachment: null });
}
async function askAssistant(provider: "gpt" | "gemini", prompt: string) {
  if (provider === "gpt") {
    if (!config.OPENAI_API_KEY) throw new Error("GPT ainda não foi configurado pelo administrador");
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.OPENAI_API_KEY}` }, body: JSON.stringify({ model: config.OPENAI_MODEL, input: prompt.slice(0, 6000) }) });
    if (!response.ok) throw new Error("A OpenAI recusou a solicitação"); const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }; return data.output_text ?? data.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "Sem resposta.";
  }
  if (!config.GEMINI_API_KEY) throw new Error("Gemini ainda não foi configurado pelo administrador");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(config.GEMINI_API_KEY)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt.slice(0, 6000) }] }] }) });
  if (!response.ok) throw new Error("O Gemini recusou a solicitação"); const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }; return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "Sem resposta.";
}
export function attachSocket(server: Server) {
  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(server, { cors: { origin: config.CLIENT_ORIGIN } });
  activeIo = io;
  io.use((socket, next) => { try { socket.data.user = readToken(socket.handshake.auth.token); next(); } catch { next(new Error("Não autenticado")); } });
  const publishPresence = () => io.emit("presence:update", [...online.values()].map(({ user }) => ({ ...user, online: true })));
  io.on("connection", async (socket) => {
    const tokenUser = socket.data.user as AuthUser;
    const fresh = await query<any>(`SELECT id,username,display_name AS "displayName",site_role AS "siteRole",custom_status AS "customStatus",CASE WHEN avatar_id IS NULL THEN NULL ELSE '/api/attachments/'||avatar_id END AS "avatarUrl" FROM users WHERE id=$1`, [tokenUser.id]);
    const user = (fresh.rows[0] ?? tokenUser) as AuthUser; socket.data.user = user;
    const entry = online.get(user.id) ?? { user, sockets: new Set<string>() }; entry.user = user; entry.sockets.add(socket.id); online.set(user.id, entry); socket.join(`user:${user.id}`); const textChannels = await query<{ id: string }>("SELECT c.id FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE m.user_id=$1 AND c.kind='text'", [user.id]); textChannels.rows.forEach(({ id }) => socket.join(`channel:${id}`)); publishPresence();
    socket.on("channel:join", async (channelId) => { const allowed = await query("SELECT 1 FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE c.id=$1 AND m.user_id=$2", [channelId, user.id]); if (allowed.rowCount) socket.join(`channel:${channelId}`); });
    socket.on("message:send", async ({ channelId, body, attachmentId }) => {
      const clean = body.trim().slice(0, 2000); if (!clean && !attachmentId) return;
      const result = await query<any>(`INSERT INTO messages(channel_id,author_id,body,attachment_id)
        SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM channels c JOIN memberships m ON m.room_id=c.room_id LEFT JOIN room_role_permissions rp ON rp.room_id=m.room_id AND rp.role=m.role WHERE c.id=$1 AND m.user_id=$2 AND (m.role='owner' OR $5='superadmin' OR coalesce((rp.permissions->>'sendMessages')::boolean,true)))
        AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM attachments WHERE id=$4 AND uploaded_by=$2))
        RETURNING id,channel_id AS "channelId",(SELECT room_id FROM channels WHERE id=channel_id) AS "roomId",coalesce(body,'') AS body,created_at AS "createdAt"`, [channelId, user.id, clean, attachmentId ?? null, user.siteRole ?? "user"]);
      if (!result.rows[0]) return; let attachment = null;
      if (attachmentId) { const file = await query<any>("SELECT id,filename,mime_type AS \"mimeType\",size_bytes AS \"sizeBytes\" FROM attachments WHERE id=$1", [attachmentId]); if (file.rows[0]) attachment = { ...file.rows[0], url: `/api/attachments/${attachmentId}` }; }
      io.to(`channel:${channelId}`).emit("message:new", { ...result.rows[0], author: user, attachment });
    });
    socket.on("dm:send", async ({ receiverId, body, attachmentId }) => {
      const clean = body.trim().slice(0, 2000); if (!clean && !attachmentId) return;
      const accepted = !!(await query("SELECT 1 WHERE EXISTS(SELECT 1 FROM friend_requests WHERE status='accepted' AND ((sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1))) OR EXISTS(SELECT 1 FROM message_requests WHERE status='accepted' AND ((sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)))", [user.id,receiverId])).rowCount;
      let requestId = ""; if (!accepted) { const request = await query<{ id:string }>("INSERT INTO message_requests(sender_id,receiver_id,status) VALUES($1,$2,'pending') ON CONFLICT(sender_id,receiver_id) DO UPDATE SET status=CASE WHEN message_requests.status='rejected' THEN 'pending' ELSE message_requests.status END,updated_at=now() RETURNING id", [user.id,receiverId]); requestId=request.rows[0]?.id??""; }
      const result = await query<any>(`INSERT INTO direct_messages(sender_id,receiver_id,body,attachment_id) SELECT $1,$2,$3,$4 WHERE ($5 OR EXISTS(SELECT 1 FROM message_requests WHERE sender_id=$1 AND receiver_id=$2 AND status='pending')) AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM attachments WHERE id=$4 AND uploaded_by=$1)) RETURNING id,sender_id AS "senderId",receiver_id AS "receiverId",coalesce(body,'') AS body,created_at AS "createdAt"`, [user.id, receiverId, clean, attachmentId ?? null, accepted]);
      if (!result.rows[0]) return; let attachment = null; if (attachmentId) { const file = await query<any>("SELECT id,filename,mime_type AS \"mimeType\",size_bytes AS \"sizeBytes\" FROM attachments WHERE id=$1", [attachmentId]); if (file.rows[0]) attachment = { ...file.rows[0], url: `/api/attachments/${attachmentId}` }; }
      io.to(`user:${user.id}`).emit("dm:new", { ...result.rows[0], author: user, attachment }); if (accepted) io.to(`user:${receiverId}`).emit("dm:new", { ...result.rows[0], author: user, attachment }); else io.to(`user:${receiverId}`).emit("message-request:new", { id:requestId,sender:user,preview:clean||"📎 Arquivo",createdAt:result.rows[0].createdAt });
    });
    socket.on("ai:ask", async ({ channelId, receiverId, provider, prompt }) => { try {
      const clean = prompt.trim(); if (!clean) return; const answer = (await askAssistant(provider, clean)).slice(0, 12000); const botName = provider === "gpt" ? "FriendGPT" : "FriendGemini"; const botUsername = provider === "gpt" ? "friendgpt" : "friendgemini";
      const bot = (await query<any>("INSERT INTO users(username,display_name,real_name,password_hash,custom_status) VALUES($1,$2,$2,'DISABLED_AI_ACCOUNT','Assistente de IA') ON CONFLICT(username) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id,username,display_name AS \"displayName\",custom_status AS \"customStatus\"", [botUsername, botName])).rows[0];
      if (channelId) { const allowed = await query("SELECT 1 FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE c.id=$1 AND m.user_id=$2", [channelId, user.id]); if (!allowed.rowCount) return; const message = (await query<any>("INSERT INTO messages(channel_id,author_id,body) VALUES($1,$2,$3) RETURNING id,channel_id AS \"channelId\",body,created_at AS \"createdAt\"", [channelId, bot.id, answer])).rows[0]; io.to(`channel:${channelId}`).emit("message:new", { ...message, author: bot, attachment: null }); }
      else if (receiverId) { const message = (await query<any>("INSERT INTO direct_messages(sender_id,receiver_id,context_peer_id,body) VALUES($1,$2,$3,$4) RETURNING id,sender_id AS \"senderId\",receiver_id AS \"receiverId\",body,created_at AS \"createdAt\"", [bot.id, user.id, receiverId, answer])).rows[0]; io.to(`user:${user.id}`).emit("dm:new", { ...message, author: bot, attachment: null }); }
    } catch (error) { socket.emit("notification", { title: provider === "gpt" ? "GPT" : "Gemini", body: (error as Error).message }); } });
    socket.on("call:join", async (channelId) => { const allowed = await query("SELECT 1 FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE c.id=$1 AND c.kind='voice' AND m.user_id=$2 AND (m.role IN ('owner','admin') OR NOT EXISTS(SELECT 1 FROM channel_access ca WHERE ca.channel_id=c.id) OR EXISTS(SELECT 1 FROM channel_access ca WHERE ca.channel_id=c.id AND ca.user_id=$2))", [channelId, user.id]); if (!allowed.rowCount) return; const room = `call:${channelId}`; const peers = await io.in(room).fetchSockets(); socket.join(room); for (const peer of peers) { peer.emit("webrtc:peer-joined", { socketId: socket.id, user }); if (peer.data.callState) socket.emit("call:state", { socketId: peer.id, user: peer.data.user as AuthUser, ...peer.data.callState }); } socket.data.callChannelId = channelId; socket.data.callState = { audioEnabled: true, videoEnabled: false, screenSharing: false }; socket.to(room).emit("call:state", { socketId: socket.id, user, ...socket.data.callState }); });
    socket.on("call:leave", (channelId) => { socket.leave(`call:${channelId}`); socket.to(`call:${channelId}`).emit("webrtc:peer-left", { socketId: socket.id }); });
    socket.on("call:state", ({ channelId, audioEnabled, videoEnabled, screenSharing }) => { if (!socket.rooms.has(`call:${channelId}`)) return; socket.data.callState = { audioEnabled, videoEnabled, screenSharing }; socket.to(`call:${channelId}`).emit("call:state", { socketId: socket.id, user, audioEnabled, videoEnabled, screenSharing }); });
    socket.on("call:moderate", async ({ channelId, targetSocketId, action }) => {
      if (!socket.rooms.has(`call:${channelId}`)) return;
      const permission = await query("SELECT 1 FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE c.id=$1 AND m.user_id=$2 AND (m.role IN ('owner','admin') OR $3='superadmin')", [channelId, user.id, user.siteRole ?? "user"]);
      if (!permission.rowCount) return;
      const target = io.sockets.sockets.get(targetSocketId);
      if (!target?.rooms.has(`call:${channelId}`)) return;
      target.emit("call:moderated", { action, by: user });
    });
    socket.on("attention:send", async ({ userId }) => {
      if (userId === user.id) return;
      const friend = await query("SELECT 1 FROM friend_requests WHERE status='accepted' AND ((sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1))", [user.id,userId]); if (!friend.rowCount) return;
      io.to(`user:${userId}`).emit("attention:receive", { from: user });
    });
    socket.on("webrtc:signal", ({ target, signal }) => io.to(target).emit("webrtc:signal", { from: socket.id, signal }));
    socket.on("media:update", ({ channelId, state }) => socket.to(`channel:${channelId}`).emit("media:state", state));
    socket.on("disconnecting", () => { for (const room of socket.rooms) if (room.startsWith("call:")) socket.to(room).emit("webrtc:peer-left", { socketId: socket.id }); });
    socket.on("disconnect", () => { const current = online.get(user.id); current?.sockets.delete(socket.id); if (!current?.sockets.size) online.delete(user.id); publishPresence(); });
  }); return io;
}
