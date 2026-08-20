import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { query } from "./db.js";
import { requireAuth, signToken } from "./auth.js";

export const routes = Router();
const credentials = z.object({ username: z.string().regex(/^[a-zA-Z0-9_]{3,32}$/), password: z.string().min(8).max(100), displayName: z.string().min(2).max(50).optional() });

routes.get("/health", (_req, res) => res.json({ ok: true }));
routes.post("/auth/register", async (req, res, next) => { try {
  const data = credentials.parse(req.body);
  const passwordHash = await bcrypt.hash(data.password, 12);
  const result = await query<{ id: string; username: string; display_name: string }>("INSERT INTO users(username,display_name,password_hash) VALUES(lower($1),$2,$3) RETURNING id,username,display_name", [data.username, data.displayName ?? data.username, passwordHash]);
  const row = result.rows[0]; const user = { id: row.id, username: row.username, displayName: row.display_name };
  res.status(201).json({ token: signToken(user), user });
} catch (error) { next(error); } });
routes.post("/auth/login", async (req, res, next) => { try {
  const data = credentials.omit({ displayName: true }).parse(req.body);
  const result = await query<{ id: string; username: string; display_name: string; password_hash: string }>("SELECT id,username,display_name,password_hash FROM users WHERE username=lower($1)", [data.username]);
  const row = result.rows[0]; if (!row || !(await bcrypt.compare(data.password, row.password_hash))) return res.status(401).json({ error: "Usuário ou senha inválidos" });
  const user = { id: row.id, username: row.username, displayName: row.display_name }; res.json({ token: signToken(user), user });
} catch (error) { next(error); } });

routes.use(requireAuth);
routes.get("/me", (req, res) => res.json(req.user));
routes.get("/rooms", async (req, res, next) => { try {
  const result = await query("SELECT r.id,r.name,r.slug,r.created_by AS \"createdBy\",m.role FROM rooms r JOIN memberships m ON m.room_id=r.id WHERE m.user_id=$1 ORDER BY r.name", [req.user!.id]); res.json(result.rows);
} catch (error) { next(error); } });
routes.post("/rooms", async (req, res, next) => { const client = await (await import("./db.js")).pool.connect(); try {
  const data = z.object({ name: z.string().min(2).max(60) }).parse(req.body); const slug = `${data.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${randomBytes(3).toString("hex")}`;
  await client.query("BEGIN"); const room = (await client.query("INSERT INTO rooms(name,slug,created_by) VALUES($1,$2,$3) RETURNING id,name,slug,created_by AS \"createdBy\"", [data.name, slug, req.user!.id])).rows[0];
  await client.query("INSERT INTO memberships(room_id,user_id,role) VALUES($1,$2,'owner')", [room.id, req.user!.id]);
  await client.query("INSERT INTO channels(room_id,name,kind) VALUES($1,'geral','text'),($1,'Geral','voice')", [room.id]); await client.query("COMMIT"); res.status(201).json({ ...room, role: "owner" });
} catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); } });
routes.get("/rooms/:roomId/channels", async (req, res, next) => { try {
  const result = await query("SELECT c.id,c.room_id AS \"roomId\",c.name,c.kind FROM channels c JOIN memberships m ON m.room_id=c.room_id WHERE c.room_id=$1 AND m.user_id=$2 ORDER BY c.kind,c.created_at", [req.params.roomId, req.user!.id]); res.json(result.rows);
} catch (error) { next(error); } });
routes.post("/rooms/:roomId/channels", async (req, res, next) => { try {
  const data = z.object({ name: z.string().min(1).max(40), kind: z.enum(["text", "voice"]) }).parse(req.body);
  const allowed = await query("SELECT 1 FROM memberships WHERE room_id=$1 AND user_id=$2 AND role IN ('owner','admin')", [req.params.roomId, req.user!.id]); if (!allowed.rowCount) return res.status(403).json({ error: "Sem permissão" });
  const result = await query("INSERT INTO channels(room_id,name,kind) VALUES($1,$2,$3) RETURNING id,room_id AS \"roomId\",name,kind", [req.params.roomId, data.name, data.kind]); res.status(201).json(result.rows[0]);
} catch (error) { next(error); } });
routes.get("/channels/:channelId/messages", async (req, res, next) => { try {
  const result = await query("SELECT m.id,m.channel_id AS \"channelId\",m.body,m.created_at AS \"createdAt\",json_build_object('id',u.id,'username',u.username,'displayName',u.display_name) AS author FROM messages m JOIN users u ON u.id=m.author_id JOIN channels c ON c.id=m.channel_id JOIN memberships ms ON ms.room_id=c.room_id WHERE m.channel_id=$1 AND ms.user_id=$2 ORDER BY m.created_at DESC LIMIT 100", [req.params.channelId, req.user!.id]); res.json(result.rows.reverse());
} catch (error) { next(error); } });
routes.post("/rooms/:roomId/invites", async (req, res, next) => { try {
  const allowed = await query("SELECT 1 FROM memberships WHERE room_id=$1 AND user_id=$2 AND role IN ('owner','admin')", [req.params.roomId, req.user!.id]); if (!allowed.rowCount) return res.status(403).json({ error: "Sem permissão" });
  const code = randomBytes(12).toString("base64url"); const result = await query("INSERT INTO invites(room_id,code,created_by,expires_at,max_uses) VALUES($1,$2,$3,now()+interval '7 days',20) RETURNING code,expires_at AS \"expiresAt\"", [req.params.roomId, code, req.user!.id]); res.status(201).json(result.rows[0]);
} catch (error) { next(error); } });
routes.post("/invites/:code/join", async (req, res, next) => { const client = await (await import("./db.js")).pool.connect(); try {
  await client.query("BEGIN"); const invite = (await client.query("SELECT * FROM invites WHERE code=$1 AND (expires_at IS NULL OR expires_at>now()) AND (max_uses IS NULL OR uses<max_uses) FOR UPDATE", [req.params.code])).rows[0]; if (!invite) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Convite inválido ou expirado" }); }
  await client.query("INSERT INTO memberships(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [invite.room_id, req.user!.id]); await client.query("UPDATE invites SET uses=uses+1 WHERE id=$1", [invite.id]); await client.query("COMMIT"); res.json({ roomId: invite.room_id });
} catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); } });
routes.get("/rooms/:roomId/members", async (req, res, next) => { try {
  const result = await query("SELECT u.id,u.username,u.display_name AS \"displayName\",m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.room_id=$1 AND EXISTS(SELECT 1 FROM memberships mine WHERE mine.room_id=m.room_id AND mine.user_id=$2) ORDER BY m.joined_at", [req.params.roomId, req.user!.id]); res.json(result.rows);
} catch (error) { next(error); } });
routes.patch("/rooms/:roomId/members/:userId", async (req, res, next) => { try {
  const role = z.object({ role: z.enum(["admin", "member"]) }).parse(req.body).role; const owner = await query("SELECT 1 FROM memberships WHERE room_id=$1 AND user_id=$2 AND role='owner'", [req.params.roomId, req.user!.id]); if (!owner.rowCount) return res.status(403).json({ error: "Apenas o dono pode alterar permissões" });
  await query("UPDATE memberships SET role=$1 WHERE room_id=$2 AND user_id=$3 AND role<>'owner'", [role, req.params.roomId, req.params.userId]); res.status(204).end();
} catch (error) { next(error); } });
