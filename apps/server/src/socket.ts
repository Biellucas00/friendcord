import type { Server } from "http";
import { Server as SocketServer } from "socket.io";
import type { CallParticipant, ClientToServerEvents, ServerToClientEvents } from "@friendcord/shared";
import { config } from "./config.js";
import { query } from "./db.js";
import { readToken, type AuthUser } from "./auth.js";
import { getChannelPermissions, hasChannelPermission } from "./permissions.js";

const online = new Map<string, { user: AuthUser; sockets: Set<string> }>();
let activeIo: SocketServer<ClientToServerEvents, ServerToClientEvents> | null = null;
export async function notifyMemberJoined(roomId: string, userId: string) {
  const person = (await query<any>(`SELECT id,username,display_name AS "displayName",custom_status AS "customStatus",CASE WHEN avatar_id IS NULL THEN NULL ELSE '/api/attachments/'||avatar_id END AS "avatarUrl" FROM users WHERE id=$1`, [userId])).rows[0];
  if (!person) return;
  activeIo?.emit("room:member-joined", { roomId, user: person });
  const textChannels = await query<{ id: string }>("SELECT id FROM channels WHERE room_id=$1 AND kind='text' ORDER BY created_at", [roomId]);
  textChannels.rows.forEach(({ id }) => activeIo?.in(`user:${userId}`).socketsJoin(`channel:${id}`));
  const channel = textChannels.rows[0];
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
const categoryAccessSql = (userReference: string, siteRoleReference: string) => `(
  c.category_id IS NULL
  OR ${siteRoleReference}='superadmin'
  OR m.role IN ('owner','admin')
  OR EXISTS (
    SELECT 1
    FROM category_role_permissions crp
    JOIN server_role_members srm ON srm.role_id=crp.role_id
    WHERE crp.category_id=c.category_id
      AND srm.user_id=${userReference}
      AND coalesce((crp.permissions->>'viewChannels')::boolean,false)
  )
  OR (
    NOT EXISTS (
      SELECT 1
      FROM category_role_permissions crp
      JOIN server_role_members srm ON srm.role_id=crp.role_id
      WHERE crp.category_id=c.category_id
        AND srm.user_id=${userReference}
        AND (crp.permissions->>'viewChannels')::boolean=false
    )
    AND NOT EXISTS (
      SELECT 1
      FROM category_role_permissions crp
      WHERE crp.category_id=c.category_id
        AND coalesce((crp.permissions->>'viewChannels')::boolean,false)
    )
  )
)`;
export function attachSocket(server: Server) {
  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(server, { cors: { origin: config.CLIENT_ORIGIN } });
  activeIo = io;
  const publishCallRoster = async (channelId: string) => {
    const channel = await query<{ roomId: string }>(`SELECT room_id AS "roomId" FROM channels WHERE id=$1`, [channelId]);
    const roomId = channel.rows[0]?.roomId;
    if (!roomId) return;
    const connected = await io.in(`call:${channelId}`).fetchSockets();
    const unique = new Map<string, CallParticipant>();
    connected.forEach((participant) => {
      const participantUser = participant.data.user as AuthUser | undefined;
      if (!participantUser) return;
      const callState = participant.data.callState ?? { audioEnabled: true, videoEnabled: false, screenSharing: false };
      unique.set(participantUser.id, { socketId: participant.id, user: participantUser, ...callState });
    });
    io.to(`server:${roomId}`).emit("call:roster", { channelId, participants: [...unique.values()] });
  };
  io.use((socket, next) => { try { socket.data.user = readToken(socket.handshake.auth.token); next(); } catch { next(new Error("Não autenticado")); } });
  const publishPresence = () => io.emit("presence:update", [...online.values()].map(({ user }) => ({ ...user, online: true })));
  io.on("connection", async (socket) => {
    const tokenUser = socket.data.user as AuthUser;
    const fresh = await query<any>(`SELECT id,username,display_name AS "displayName",site_role AS "siteRole",custom_status AS "customStatus",CASE WHEN avatar_id IS NULL THEN NULL ELSE '/api/attachments/'||avatar_id END AS "avatarUrl" FROM users WHERE id=$1`, [tokenUser.id]);
    const user = (fresh.rows[0] ?? tokenUser) as AuthUser; socket.data.user = user;
    const memberships = await query<{ roomId: string }>(`SELECT room_id AS "roomId" FROM memberships WHERE user_id=$1`, [user.id]);
    memberships.rows.forEach(({ roomId }) => socket.join(`server:${roomId}`));
    const visibleVoiceChannels = await query<{ id: string }>(`SELECT c.id FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE m.user_id=$1 AND c.kind='voice'`, [user.id]);
    await Promise.all(visibleVoiceChannels.rows.map(({ id }) => publishCallRoster(id)));
    const entry = online.get(user.id) ?? { user, sockets: new Set<string>() }; entry.user = user; entry.sockets.add(socket.id); online.set(user.id, entry); socket.join(`user:${user.id}`); const textChannels = await query<{ id: string }>(`SELECT c.id FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE m.user_id=$1 AND c.kind='text' AND ${categoryAccessSql("$1","$2")} AND ($2='superadmin' OR m.role IN ('owner','admin') OR (NOT EXISTS(SELECT 1 FROM channel_access ca WHERE ca.channel_id=c.id) AND NOT EXISTS(SELECT 1 FROM channel_role_access cra WHERE cra.channel_id=c.id)) OR EXISTS(SELECT 1 FROM channel_access ca WHERE ca.channel_id=c.id AND ca.user_id=$1) OR EXISTS(SELECT 1 FROM channel_role_access cra JOIN server_role_members srm ON srm.role_id=cra.role_id WHERE cra.channel_id=c.id AND srm.user_id=$1))`, [user.id,user.siteRole ?? "user"]); textChannels.rows.forEach(({ id }) => socket.join(`channel:${id}`)); publishPresence();
    socket.on("channel:join", async (channelId) => { const allowed = await query(`SELECT 1 FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE c.id=$1 AND m.user_id=$2 AND ${categoryAccessSql("$2","$3")} AND ($3='superadmin' OR m.role IN ('owner','admin') OR (NOT EXISTS(SELECT 1 FROM channel_access ca WHERE ca.channel_id=c.id) AND NOT EXISTS(SELECT 1 FROM channel_role_access cra WHERE cra.channel_id=c.id)) OR EXISTS(SELECT 1 FROM channel_access ca WHERE ca.channel_id=c.id AND ca.user_id=$2) OR EXISTS(SELECT 1 FROM channel_role_access cra JOIN server_role_members srm ON srm.role_id=cra.role_id WHERE cra.channel_id=c.id AND srm.user_id=$2))`, [channelId, user.id, user.siteRole ?? "user"]); if (allowed.rowCount) socket.join(`channel:${channelId}`); });
    socket.on("message:send", async ({ channelId, body, attachmentId }) => {
      const clean = body.trim().slice(0, 2000); if (!clean && !attachmentId) return;
      const resolved = await getChannelPermissions(channelId,user.id,user.siteRole);
      if (!resolved?.accessible || (!resolved.permissions.administrator && !resolved.permissions.sendMessages)) return socket.emit("notification",{title:"Permissão negada",body:"Você não pode enviar mensagens neste canal."});
      if (attachmentId && !resolved.permissions.administrator && !resolved.permissions.attachFiles) return socket.emit("notification",{title:"Permissão negada",body:"Você não pode anexar arquivos neste canal."});
      if (/@(?:everyone|here)\b/i.test(clean) && !resolved.permissions.administrator && !resolved.permissions.mentionEveryone) return socket.emit("notification",{title:"Permissão negada",body:"Você não pode mencionar @everyone ou @here."});
      if (attachmentId) { const attachment = await query<{ mimeType:string }>(`SELECT mime_type AS "mimeType" FROM attachments WHERE id=$1 AND uploaded_by=$2`,[attachmentId,user.id]); if (attachment.rows[0]?.mimeType.startsWith("audio/") && !resolved.permissions.administrator && !resolved.permissions.sendVoiceMessages) return socket.emit("notification",{title:"Permissão negada",body:"Você não pode enviar mensagens de voz neste canal."}); }
      const result = await query<any>(`INSERT INTO messages(channel_id,author_id,body,attachment_id)
        SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM channels WHERE id=$1)
        AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM attachments WHERE id=$4 AND uploaded_by=$2))
        RETURNING id,channel_id AS "channelId",(SELECT room_id FROM channels WHERE id=channel_id) AS "roomId",coalesce(body,'') AS body,created_at AS "createdAt"`, [channelId, user.id, clean, attachmentId ?? null]);
      if (!result.rows[0]) return; let attachment = null;
      if (attachmentId) { const file = await query<any>("SELECT id,filename,mime_type AS \"mimeType\",size_bytes AS \"sizeBytes\" FROM attachments WHERE id=$1", [attachmentId]); if (file.rows[0]) attachment = { ...file.rows[0], url: `/api/attachments/${attachmentId}` }; }
      io.to(`channel:${channelId}`).emit("message:new", { ...result.rows[0], author: user, attachment });
      const mentionedUsernames = [...new Set([...clean.matchAll(/@([a-zA-Z0-9_]{3,32})/g)].map((match) => match[1].toLowerCase()))].filter((username) => username !== user.username.toLowerCase() && username !== "gpt" && username !== "gemini");
      if (mentionedUsernames.length) {
        const mentionedUsers = await query<{ id: string; username: string }>(`SELECT u.id,u.username FROM users u JOIN memberships m ON m.user_id=u.id JOIN channels c ON c.room_id=m.room_id WHERE c.id=$1 AND lower(u.username)=ANY($2::text[])`, [channelId, mentionedUsernames]);
        mentionedUsers.rows.forEach((mentioned) => io.to(`user:${mentioned.id}`).emit("notification", { title: `@${user.username} mencionou você`, body: clean.slice(0, 160) }));
      }
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
      if (channelId) { if (!(await hasChannelPermission(channelId,user.id,user.siteRole,"useApplicationCommands"))) return socket.emit("notification",{title:"Permissão negada",body:"Você não pode usar aplicativos neste canal."}); const message = (await query<any>("INSERT INTO messages(channel_id,author_id,body) VALUES($1,$2,$3) RETURNING id,channel_id AS \"channelId\",body,created_at AS \"createdAt\"", [channelId, bot.id, answer])).rows[0]; io.to(`channel:${channelId}`).emit("message:new", { ...message, author: bot, attachment: null }); }
      else if (receiverId) { const message = (await query<any>("INSERT INTO direct_messages(sender_id,receiver_id,context_peer_id,body) VALUES($1,$2,$3,$4) RETURNING id,sender_id AS \"senderId\",receiver_id AS \"receiverId\",body,created_at AS \"createdAt\"", [bot.id, user.id, receiverId, answer])).rows[0]; io.to(`user:${user.id}`).emit("dm:new", { ...message, author: bot, attachment: null }); }
    } catch (error) {
      const botName = provider === "gpt" ? "FriendGPT" : "FriendGemini";
      const botUsername = provider === "gpt" ? "friendgpt" : "friendgemini";
      const failure = `${(error as Error).message}. O administrador precisa configurar a chave oficial dessa IA no Render.`;
      const bot = (await query<any>("INSERT INTO users(username,display_name,real_name,password_hash,custom_status) VALUES($1,$2,$2,'DISABLED_AI_ACCOUNT','Assistente de IA') ON CONFLICT(username) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id,username,display_name AS \"displayName\",custom_status AS \"customStatus\"", [botUsername, botName])).rows[0];
      if (channelId) {
        const message = (await query<any>("INSERT INTO messages(channel_id,author_id,body) SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE c.id=$1 AND m.user_id=$4) RETURNING id,channel_id AS \"channelId\",body,created_at AS \"createdAt\"", [channelId, bot.id, failure, user.id])).rows[0];
        if (message) io.to(`channel:${channelId}`).emit("message:new", { ...message, author: bot, attachment: null });
      } else if (receiverId) {
        const message = (await query<any>("INSERT INTO direct_messages(sender_id,receiver_id,context_peer_id,body) VALUES($1,$2,$3,$4) RETURNING id,sender_id AS \"senderId\",receiver_id AS \"receiverId\",body,created_at AS \"createdAt\"", [bot.id, user.id, receiverId, failure])).rows[0];
        io.to(`user:${user.id}`).emit("dm:new", { ...message, author: bot, attachment: null });
      } else socket.emit("notification", { title: botName, body: failure });
    } });
    socket.on("call:join", async (channelId) => { const resolved=await getChannelPermissions(channelId,user.id,user.siteRole); if (!resolved?.accessible || (!resolved.permissions.administrator&&!resolved.permissions.connectVoice)) return socket.emit("notification",{title:"Permissão negada",body:"Você não pode entrar neste canal de voz."}); const room = `call:${channelId}`; const peers = await io.in(room).fetchSockets(); socket.join(room); for (const peer of peers) { peer.emit("webrtc:peer-joined", { socketId: socket.id, user }); if (peer.data.callState) socket.emit("call:state", { socketId: peer.id, user: peer.data.user as AuthUser, ...peer.data.callState }); } socket.data.callChannelId = channelId; socket.data.callState = { audioEnabled:!!(resolved.permissions.administrator||resolved.permissions.speak), videoEnabled: false, screenSharing: false }; socket.to(room).emit("call:state", { socketId: socket.id, user, ...socket.data.callState }); await publishCallRoster(channelId); });
    socket.on("call:leave", async (channelId) => { socket.leave(`call:${channelId}`); socket.data.callChannelId = undefined; socket.data.callState = undefined; socket.to(`call:${channelId}`).emit("webrtc:peer-left", { socketId: socket.id }); await publishCallRoster(channelId); });
    socket.on("call:state", async ({ channelId, audioEnabled, videoEnabled, screenSharing }) => { if (!socket.rooms.has(`call:${channelId}`)) return; const resolved=await getChannelPermissions(channelId,user.id,user.siteRole); if(!resolved)return; const canSpeak=!!(resolved.permissions.administrator||resolved.permissions.speak); const canStream=!!(resolved.permissions.administrator||resolved.permissions.stream); const nextState={audioEnabled:audioEnabled&&canSpeak,videoEnabled:videoEnabled&&canStream,screenSharing:screenSharing&&canStream}; socket.data.callState = nextState; socket.to(`call:${channelId}`).emit("call:state", { socketId: socket.id, user, ...nextState }); await publishCallRoster(channelId); });
    socket.on("call:moderate", async ({ channelId, targetSocketId, action }) => {
      if (!socket.rooms.has(`call:${channelId}`)) return;
      const permission = action === "mute" ? "muteMembers" : "muteMembers";
      if (!(await hasChannelPermission(channelId,user.id,user.siteRole,permission))) return socket.emit("notification",{title:"Permissão negada",body:"Você não pode moderar participantes nesta chamada."});
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
    socket.on("media:update", async ({ channelId, state }) => { if(await hasChannelPermission(channelId,user.id,user.siteRole,"useEmbeddedActivities")) socket.to(`channel:${channelId}`).emit("media:state", state); else socket.emit("notification",{title:"Permissão negada",body:"Você não pode sincronizar mídia neste canal."}); });
    socket.on("disconnecting", () => { for (const room of socket.rooms) if (room.startsWith("call:")) socket.to(room).emit("webrtc:peer-left", { socketId: socket.id }); });
    socket.on("disconnect", () => { const previousCallChannelId = socket.data.callChannelId as string | undefined; const current = online.get(user.id); current?.sockets.delete(socket.id); if (!current?.sockets.size) online.delete(user.id); publishPresence(); if (previousCallChannelId) void publishCallRoster(previousCallChannelId); });
  }); return io;
}
