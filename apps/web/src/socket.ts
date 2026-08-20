import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@friendcord/shared";
import { API_URL, getToken } from "./api";
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
export function getSocket() { if (!socket) socket = io(API_URL, { auth: { token: getToken() }, autoConnect: false }); return socket; }
export function resetSocket() { socket?.disconnect(); socket = null; }
