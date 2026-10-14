import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode, command }) => {
  // Make .env visible to server code (process.env) in dev/build. Real environment variables win,
  // and these values are not exposed to the browser (only VITE_-prefixed vars are).
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ""))) {
    process.env[key] ??= value;
  }

  // The local development identity switcher must never be built into anything that could be deployed.
  // A build is a production build by definition, so any value of the flag fails it. (Unset it, or set it to
  // empty, for the build; keep it only for `npm run dev`.)
  if (command === "build" && process.env.VSHOW_DEV_AUTH?.trim()) {
    throw new Error(
      "VSHOW_DEV_AUTH is set during a production build. The development identity switcher is local-only: " +
        "unset VSHOW_DEV_AUTH (or set it empty) before building.",
    );
  }

  return {
    // The OAuth redirect URI registered with vauth is http://localhost:5173/...: if the port were taken, Vite
    // would silently pick another and every sign-in would fail with a redirect-URI mismatch. Fail instead.
    server: { port: 5173, strictPort: true },
    plugins: [tailwindcss(), reactRouter()],
    resolve: {
      tsconfigPaths: true,
    },
  };
});
