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
  activeSocket.connect();
  return new Promise<typeof activeSocket>((resolve, reject) => {
    const timer = window.setTimeout(() => { cleanup(); reject(new Error("Servidor de mensagens indisponível. Tente novamente.")); }, 15000);
    const cleanup = () => { window.clearTimeout(timer); activeSocket.off("connect", connected); activeSocket.off("connect_error", failed); };
    const connected = () => { cleanup(); resolve(activeSocket); };
    const failed = () => { cleanup(); reject(new Error("Não foi possível conectar ao servidor de mensagens.")); };
    activeSocket.once("connect", connected);
    activeSocket.once("connect_error", failed);
  });
}
export function resetSocket() { socket?.disconnect(); socket = null; }
