import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@friendcord/shared";
import { API_URL, getToken } from "./api";
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
export function getSocket() {
  if (!socket) socket = io(API_URL, { auth: { token: getToken() }, autoConnect: false, reconnection: true, reconnectionAttempts: Infinity, timeout: 15000 });
  socket.auth = { token: getToken() };
  return socket;
}
export function ensureSocketConnected() {
  const activeSocket = getSocket();
  if (activeSocket.connected) return Promise.resolve(activeSocket);
  return new Promise<typeof activeSocket>((resolve, reject) => {
    let lastError = "Servidor de mensagens indisponível. Tente novamente.";
    const timer = window.setTimeout(() => { cleanup(); reject(new Error(lastError)); }, 45000);
    const cleanup = () => { window.clearTimeout(timer); activeSocket.off("connect", connected); activeSocket.off("connect_error", failed); };
    const connected = () => { cleanup(); resolve(activeSocket); };
    const failed = (error: Error) => { lastError = error.message || "Não foi possível conectar ao servidor de mensagens."; };
    activeSocket.once("connect", connected);
    activeSocket.on("connect_error", failed);
    activeSocket.connect();
  });
}
export function resetSocket() { socket?.disconnect(); socket = null; }
