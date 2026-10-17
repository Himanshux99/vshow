// Where a signed-in person lands: their primary work page, not the account page. Safe to import on the client.
// The server still enforces access on every route; this only picks the destination.
export function landingPath(roles: readonly string[]): string {
  if (roles.includes("CONVENER")) return "/submissions";
  if (roles.includes("REVIEWER")) return "/review";
  if (roles.includes("SERVER_ROOM_MANAGER")) return "/manager";
  if (roles.includes("ADMIN")) return "/admin";
  return "/me";
}

export const ROLE_LABEL: Record<string, string> = {
  CONVENER: "Committee convener",
  REVIEWER: "Corporate Communication reviewer",
  SERVER_ROOM_MANAGER: "Server Room Manager",
  ADMIN: "Administrator",
};
