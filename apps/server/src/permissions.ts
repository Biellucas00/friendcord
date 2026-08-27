import { query } from "./db.js";

export type Permissions = Record<string, boolean>;

export const memberPermissionDefaults: Permissions = {
  viewChannels: true,
  sendMessages: true,
  sendVoiceMessages: true,
  attachFiles: true,
  embedLinks: true,
  addReactions: true,
  useExternalEmojis: true,
  useExternalStickers: true,
  readMessageHistory: true,
  useApplicationCommands: true,
  useEmbeddedActivities: true,
  connectVoice: true,
  speak: true,
  stream: true,
  useVoiceActivity: true
};

type MembershipPermissions = {
  role: "owner" | "admin" | "member";
  basePermissions: Permissions | null;
  customPermissions: Permissions[] | null;
};

export async function getRoomPermissions(roomId: string, userId: string, siteRole?: string): Promise<Permissions> {
  if (siteRole === "superadmin") return { administrator: true };
  const result = await query<MembershipPermissions>(`SELECT m.role,
    rp.permissions AS "basePermissions",
    coalesce((SELECT json_agg(sr.permissions) FROM server_role_members srm JOIN server_roles sr ON sr.id=srm.role_id WHERE srm.user_id=m.user_id AND sr.room_id=m.room_id),'[]') AS "customPermissions"
    FROM memberships m LEFT JOIN room_role_permissions rp ON rp.room_id=m.room_id AND rp.role=m.role
    WHERE m.room_id=$1 AND m.user_id=$2`, [roomId, userId]);
  const membership = result.rows[0];
  if (!membership) return {};
  if (membership.role === "owner") return { administrator: true };
  const permissions: Permissions = membership.role === "member" ? { ...memberPermissionDefaults } : {};
  Object.assign(permissions, membership.basePermissions ?? {});
  for (const custom of membership.customPermissions ?? []) {
    for (const [key, allowed] of Object.entries(custom ?? {})) if (allowed) permissions[key] = true;
  }
  return permissions.administrator ? { ...permissions, administrator: true } : permissions;
}

export async function hasRoomPermission(roomId: string, userId: string, siteRole: string | undefined, permission: string) {
  const permissions = await getRoomPermissions(roomId, userId, siteRole);
  return !!(permissions.administrator || permissions[permission]);
}

export async function getChannelPermissions(channelId: string, userId: string, siteRole?: string): Promise<{ roomId: string; permissions: Permissions; accessible: boolean } | null> {
  const channel = await query<{ roomId: string; categoryId: string | null }>(`SELECT room_id AS "roomId",category_id AS "categoryId" FROM channels WHERE id=$1`, [channelId]);
  const current = channel.rows[0];
  if (!current) return null;
  const permissions = await getRoomPermissions(current.roomId, userId, siteRole);
  if (permissions.administrator) return { roomId: current.roomId, permissions, accessible: true };

  if (current.categoryId) {
    const overrides = await query<{ permissions: Permissions }>(`SELECT crp.permissions FROM category_role_permissions crp
      JOIN server_role_members srm ON srm.role_id=crp.role_id
      WHERE crp.category_id=$1 AND srm.user_id=$2`, [current.categoryId, userId]);
    const keys = new Set(overrides.rows.flatMap((row) => Object.keys(row.permissions ?? {})));
    for (const key of keys) {
      const values = overrides.rows.filter((row) => key in (row.permissions ?? {})).map((row) => row.permissions[key]);
      if (values.includes(false)) permissions[key] = false;
      else if (values.includes(true)) permissions[key] = true;
    }
  }

  const access = await query<{ restricted: boolean; allowed: boolean }>(`SELECT
    (EXISTS(SELECT 1 FROM channel_access WHERE channel_id=$1) OR EXISTS(SELECT 1 FROM channel_role_access WHERE channel_id=$1)) AS restricted,
    (EXISTS(SELECT 1 FROM channel_access WHERE channel_id=$1 AND user_id=$2) OR EXISTS(SELECT 1 FROM channel_role_access cra JOIN server_role_members srm ON srm.role_id=cra.role_id WHERE cra.channel_id=$1 AND srm.user_id=$2)) AS allowed`, [channelId, userId]);
  const restriction = access.rows[0];
  return { roomId: current.roomId, permissions, accessible: !!permissions.viewChannels && (!restriction?.restricted || restriction.allowed) };
}

export async function hasChannelPermission(channelId: string, userId: string, siteRole: string | undefined, permission: string) {
  const resolved = await getChannelPermissions(channelId, userId, siteRole);
  return !!(resolved?.accessible && (resolved.permissions.administrator || resolved.permissions[permission]));
}
