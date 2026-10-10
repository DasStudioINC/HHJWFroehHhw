import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Local development proxy for the protected hosted backend.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "https://alliaiagent.yurphagames.net",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
