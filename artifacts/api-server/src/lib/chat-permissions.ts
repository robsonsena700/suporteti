export type ChatRole = "ADMIN" | "ANALYST" | "COORDINATOR" | "USER" | string;

export const CHAT_MODULE_ROLES: ChatRole[] = ["ADMIN", "ANALYST", "COORDINATOR"];
export const CHAT_FULL_ACCESS_ROLES: ChatRole[] = ["ADMIN", "ANALYST"];

export function hasChatModuleAccess(role: ChatRole): boolean {
  return CHAT_MODULE_ROLES.includes(role);
}

export function hasFullChatAccess(role: ChatRole): boolean {
  return CHAT_FULL_ACCESS_ROLES.includes(role);
}

export function canCoordinatorAccessTargetRole(targetRole: ChatRole): boolean {
  return targetRole === "ANALYST" || targetRole === "ADMIN";
}
