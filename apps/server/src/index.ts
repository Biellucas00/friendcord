import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { ZodError } from "zod";
import { config } from "./config.js";
import { routes } from "./routes.js";
import { attachSocket } from "./socket.js";
import { reportError } from "./telemetry.js";

const allowedOrigins = [config.CLIENT_ORIGIN, "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"];
const app = express();
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "32kb" }));
app.post("/api/telemetry/client", (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 3500) : "Erro desconhecido no cliente";
  const context = typeof req.body?.context === "object" && req.body.context ? req.body.context : {};
  void reportError("cliente", message, { ...context, url: req.body?.url, userAgent: req.body?.userAgent });
  res.status(202).json({ ok: true });
});
app.use("/api", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); }, routes);
app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error(error); void reportError("servidor", error, { method: req.method, path: req.path }); if (error instanceof ZodError) return res.status(400).json({ error: error.issues[0]?.message }); const databaseError = error as { code?: string; constraint?: string }; if (databaseError.code === "23505") return res.status(409).json({ error: databaseError.constraint === "users_username_key" ? "Este nome de usuário já está em uso" : "Registro já existe" }); res.status(500).json({ error: "Erro interno" }); });
const server = createServer(app); attachSocket(server); server.listen(config.PORT, "0.0.0.0", () => console.log("FriendCord API na porta " + config.PORT));
