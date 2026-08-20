import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
export interface AuthUser { id: string; username: string; displayName: string }
declare global { namespace Express { interface Request { user?: AuthUser } } }
export const signToken = (user: AuthUser) => jwt.sign(user, config.JWT_SECRET, { expiresIn: "7d" });
export const readToken = (token: string) => jwt.verify(token, config.JWT_SECRET) as AuthUser;
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try { const token = req.headers.authorization?.replace(/^Bearer /, ""); if (!token) throw new Error(); req.user = readToken(token); next(); }
  catch { res.status(401).json({ error: "Não autenticado" }); }
}
