import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.ts"),
  route("unclaimed", "routes/unclaimed.tsx"),
  route("me", "routes/me.tsx"),
  // Local development only: the loader answers 404 unless every dev-auth guard passed at startup.
  route("dev/login", "routes/dev.login.tsx"),
  // Better Auth (OAuth callback). Default-deny allowlist: see app/auth/route-policy.server.ts.
  route("api/auth/*", "routes/api.auth.$.ts"),
] satisfies RouteConfig;
