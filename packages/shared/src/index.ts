export type Role = "owner" | "admin" | "member";
export interface PublicUser { id: string; username: string; displayName: string; realName?: string; email?: string; siteRole?: "user" | "superadmin"; role?: Role; online?: boolean; customStatus?: string; avatarUrl?: string | null; bannerUrl?: string | null }
export interface Room { id: string; name: string; slug: string; createdBy: string; iconUrl?: string | null; bannerUrl?: string | null }
export interface Channel { id: string; roomId: string; name: string; kind: "text" | "voice"; categoryId?: string | null; restricted?: boolean }
export interface ChannelCategory { id: string; roomId: string; name: string; position: number }
export interface ServerRole { id: string; roomId: string; name: string; color: string; permissions: Record<string, boolean>; memberIds: string[]; categoryPermissions: Record<string, Record<string, boolean>> }
export interface Attachment { id: string; filename: string; mimeType: string; sizeBytes: number; url: string }
export interface ChatMessage { id: string; channelId: string; roomId?: string; body: string; createdAt: string; author: PublicUser; attachment?: Attachment | null }
export interface DirectMessage { id: string; senderId: string; receiverId: string; body: string; createdAt: string; author: PublicUser; attachment?: Attachment | null }
export interface MessageRequest { id: string; sender: PublicUser; preview: string; createdAt: string }
export interface MediaState { provider: "youtube" | "spotify"; mediaId: string; mediaType?: string; playing: boolean; positionSeconds: number; updatedAt: number }
export interface CallParticipant { socketId: string; user: PublicUser; audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }
export interface ServerToClientEvents {
  "message:new": (message: ChatMessage) => void;
  "dm:new": (message: DirectMessage) => void;
  "presence:update": (users: PublicUser[]) => void;
  "webrtc:peer-joined": (data: { socketId: string; user: PublicUser }) => void;
  "webrtc:peer-left": (data: { socketId: string }) => void;
  "webrtc:signal": (data: { from: string; signal: unknown }) => void;
  "call:state": (data: { socketId: string; user: PublicUser; audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }) => void;
  "call:roster": (data: { channelId: string; participants: CallParticipant[] }) => void;
  "call:moderated": (data: { action: "mute" | "stop-screen"; by: PublicUser }) => void;
  "attention:receive": (data: { from: PublicUser }) => void;
  "room:member-joined": (data: { roomId: string; user: PublicUser }) => void;
  "message-request:new": (request: MessageRequest) => void;
  "media:state": (state: MediaState) => void;
  notification: (data: { title: string; body: string }) => void;
}
export interface ClientToServerEvents {
  "channel:join": (channelId: string) => void;
  "message:send": (data: { channelId: string; body: string; attachmentId?: string }) => void;
  "dm:send": (data: { receiverId: string; body: string; attachmentId?: string }) => void;
  "ai:ask": (data: { channelId?: string; receiverId?: string; provider: "gpt" | "gemini"; prompt: string }) => void;
  "call:join": (channelId: string) => void;
  "call:leave": (channelId: string) => void;
  "call:state": (data: { channelId: string; audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }) => void;
  "call:moderate": (data: { channelId: string; targetSocketId: string; action: "mute" | "stop-screen" }) => void;
  "attention:send": (data: { userId: string }) => void;
  "webrtc:signal": (data: { target: string; signal: unknown }) => void;
  "media:update": (data: { channelId: string; state: MediaState }) => void;
}
