export type Role = "owner" | "admin" | "member";
export interface PublicUser { id: string; username: string; displayName: string; role?: Role; online?: boolean }
export interface Room { id: string; name: string; slug: string; createdBy: string }
export interface Channel { id: string; roomId: string; name: string; kind: "text" | "voice" }
export interface ChatMessage { id: string; channelId: string; body: string; createdAt: string; author: PublicUser }
export interface MediaState { provider: "youtube" | "spotify"; mediaId: string; playing: boolean; positionSeconds: number; updatedAt: number }
export interface ServerToClientEvents {
  "message:new": (message: ChatMessage) => void;
  "presence:update": (users: PublicUser[]) => void;
  "webrtc:peer-joined": (data: { socketId: string; user: PublicUser }) => void;
  "webrtc:peer-left": (data: { socketId: string }) => void;
  "webrtc:signal": (data: { from: string; signal: unknown }) => void;
  "media:state": (state: MediaState) => void;
  notification: (data: { title: string; body: string }) => void;
}
export interface ClientToServerEvents {
  "channel:join": (channelId: string) => void;
  "message:send": (data: { channelId: string; body: string }) => void;
  "call:join": (channelId: string) => void;
  "call:leave": (channelId: string) => void;
  "webrtc:signal": (data: { target: string; signal: unknown }) => void;
  "media:update": (data: { channelId: string; state: MediaState }) => void;
}
