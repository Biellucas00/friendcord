export type Role = "owner" | "admin" | "member";
export interface PublicUser { id: string; username: string; displayName: string; realName?: string; email?: string; siteRole?: "user" | "superadmin"; role?: Role; online?: boolean; avatarUrl?: string | null; bannerUrl?: string | null }
export interface Room { id: string; name: string; slug: string; createdBy: string; iconUrl?: string | null; bannerUrl?: string | null }
export interface Channel { id: string; roomId: string; name: string; kind: "text" | "voice"; restricted?: boolean }
export interface Attachment { id: string; filename: string; mimeType: string; sizeBytes: number; url: string }
export interface ChatMessage { id: string; channelId: string; body: string; createdAt: string; author: PublicUser; attachment?: Attachment | null }
export interface MediaState { provider: "youtube" | "spotify"; mediaId: string; playing: boolean; positionSeconds: number; updatedAt: number }
export interface ServerToClientEvents {
  "message:new": (message: ChatMessage) => void;
  "presence:update": (users: PublicUser[]) => void;
  "webrtc:peer-joined": (data: { socketId: string; user: PublicUser }) => void;
  "webrtc:peer-left": (data: { socketId: string }) => void;
  "webrtc:signal": (data: { from: string; signal: unknown }) => void;
  "call:state": (data: { socketId: string; user: PublicUser; audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }) => void;
  "media:state": (state: MediaState) => void;
  notification: (data: { title: string; body: string }) => void;
}
export interface ClientToServerEvents {
  "channel:join": (channelId: string) => void;
  "message:send": (data: { channelId: string; body: string; attachmentId?: string }) => void;
  "call:join": (channelId: string) => void;
  "call:leave": (channelId: string) => void;
  "call:state": (data: { channelId: string; audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }) => void;
  "webrtc:signal": (data: { target: string; signal: unknown }) => void;
  "media:update": (data: { channelId: string; state: MediaState }) => void;
}
