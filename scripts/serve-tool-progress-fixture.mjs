// Isolated Vite fixture server: TanStack's app router deliberately rejects arbitrary HTML paths.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const server = await createServer({ configFile: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  server: { host: "0.0.0.0", port: 8080, strictPort: true },
});
await server.listen();
server.printUrls();
