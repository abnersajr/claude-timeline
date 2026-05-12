import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [TanStackRouterVite({ quoteStyle: "double" }), tailwindcss(), react()],
  server: {
    port: 5199,
    strictPort: true,
    host: true,
    allowedHosts: ["claude-dash.local", "localhost"],
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
})
