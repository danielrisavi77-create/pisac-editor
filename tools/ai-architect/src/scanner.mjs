import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const SKIP = new Set([".git","node_modules",".next","dist","build","coverage",".netlify"]);
const TEXT_EXT = new Set([".js",".mjs",".cjs",".ts",".tsx",".jsx",".json",".md",".html",".css",".yml",".yaml",".toml",".py",".sql"]);

async function walk(root, dir = root, out = []) {
  for (const entry of await readdir(dir, { withFileTypes:true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(root, full, out);
    else out.push(relative(root, full));
  }
  return out;
}

export async function scanRepo(root = process.cwd()) {
  const files = await walk(root);
  const byExt = {};
  for (const file of files) {
    const ext = extname(file).toLowerCase() || "[none]";
    byExt[ext] = (byExt[ext] || 0) + 1;
  }

  const manifests = [];
  for (const name of ["package.json","pyproject.toml","requirements.txt","netlify.toml","Dockerfile","README.md"]) {
    try {
      const s = await stat(join(root,name));
      if (s.isFile()) manifests.push(name);
    } catch {}
  }

  let readme = "";
  try { readme = await readFile(join(root,"README.md"),"utf8"); } catch {}

  const signals = {
    staticWeb: files.some(f => f.endsWith(".html")) && files.some(f => f.endsWith(".css")),
    node: manifests.includes("package.json"),
    python: manifests.includes("pyproject.toml") || manifests.includes("requirements.txt"),
    netlify: manifests.includes("netlify.toml"),
    academic: /academic|akadem|citation|mentor|student|bibliograph|literatur/i.test(readme),
    ai: files.some(f => /(^|\/)(ai|prompts?|agents?)(\/|\.|$)/i.test(f)) || /\bAI\b|LLM|model/i.test(readme)
  };

  return { root, fileCount:files.length, byExt, manifests, signals, sampledFiles:files.slice(0,80) };
}
