// Isolated Vite fixture server: TanStack's app router deliberately rejects arbitrary HTML paths.
import { build, createServer, preview } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const production = process.argv.includes("--production");
const config = { configFile: false,
  plugins: [{ name: "fixture-action-boundary", enforce: "pre",
    resolveId(id) { if (id === "@/lib/actions") return "\0fixture-actions"; },
    load(id) { if (id === "\0fixture-actions") return "export async function runAction(action) { if (action.kind === 'emotion.report') return '已核对'; return new Promise(() => {}); }"; },
  }, react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  server: { host: "0.0.0.0", port: 8080, strictPort: true },
  preview: { host: "0.0.0.0", port: 8081, strictPort: true },
  build: { outDir: ".tool-progress-dist", emptyOutDir: true,
    rollupOptions: { input: ["tool-progress-fixture.html", "tool-reply-fixture.html"].map((p) => fileURLToPath(new URL(p, import.meta.url))) } },
};
if (production) await build(config);
const server = production ? await preview(config) : await createServer(config);
if (!production) await server.listen();
server.printUrls();
