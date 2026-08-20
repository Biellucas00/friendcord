import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { ZodError } from "zod";
import { config } from "./config.js";
import { routes } from "./routes.js";
import { attachSocket } from "./socket.js";

const app = express(); app.use(cors({ origin: config.CLIENT_ORIGIN })); app.use(express.json({ limit: "32kb" })); app.use("/api", routes);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error(error); if (error instanceof ZodError) return res.status(400).json({ error: error.issues[0]?.message }); const databaseError = error as { code?: string; constraint?: string }; if (databaseError.code === "23505") return res.status(409).json({ error: databaseError.constraint === "users_username_key" ? "Este nome de usuário já está em uso" : "Registro já existe" }); res.status(500).json({ error: "Erro interno" }); });
const server = createServer(app); attachSocket(server); server.listen(config.PORT, "0.0.0.0", () => console.log(`FriendCord API na porta ${config.PORT}`));
