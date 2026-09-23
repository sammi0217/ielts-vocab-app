// Builds mock/data.json (gitignored) from the old local build so the UI can be tested without the Sheet.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");
const m = html.match(/const WORDS = (\[.*?\]);\n/s);
if (!m) throw new Error("WORDS not found in dist/index.html");
const words = JSON.parse(m[1]).map((w, i) => ({ row: i + 2, ...w }));
mkdirSync("mock", { recursive: true });
writeFileSync("mock/data.json", JSON.stringify({ words, log: [] }));
console.log(`mock/data.json: ${words.length} words`);
