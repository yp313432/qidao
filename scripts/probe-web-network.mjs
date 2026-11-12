// Diagnostic evidence from the CI network, separate from deterministic regressions.
import { mkdirSync, writeFileSync } from "node:fs";
import { readWebPage, webSearch } from "../src/lib/web-http.ts";
mkdirSync("screenshots", { recursive: true });
const [page, search] = await Promise.all([
  readWebPage("https://example.com", { timeoutMs: 8000 }),
  webSearch("山东 女子 切糕 索赔", { timeoutMs: 10_000, limit: 3 }),
]);
const report = { checkedAt: new Date().toISOString(), network: "GitHub Actions (does not establish phone connectivity)",
  page: page.ok ? { ok: true, title: page.title, chars: page.chars, status: page.status } : page,
  search: search.ok ? { ok: true, engine: search.engine, count: search.results.length,
    results: search.results.map(({ title, url }) => ({ title, url })) } : search };
writeFileSync("screenshots/web-network.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
