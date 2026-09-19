import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const SKIP = new Set([".git","node_modules",".next","dist","build","coverage",".netlify",".cache"]);
const TEXT_EXT = new Set([".js",".mjs",".cjs",".ts",".tsx",".jsx",".json",".md",".html",".css",".yml",".yaml",".toml",".py",".sql",".txt"]);
const INSTRUCTION_NAMES = new Set([
  "AGENTS.md","CLAUDE.md","CODEX.md","copilot-instructions.md","README.md"
]);

async function walk(root, dir = root, out = []) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes:true }); } catch { return out; }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(root, full, out);
    else out.push(relative(root, full).replaceAll("\\","/"));
  }
  return out;
}

async function safeRead(root, path, maxBytes = 160000) {
  try {
    const full = join(root, path);
    const info = await stat(full);
    if (!info.isFile() || info.size > maxBytes) return "";
    return await readFile(full, "utf8");
  } catch {
    return "";
  }
}

function containsAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export async function scanRepo(root = process.cwd()) {
  const files = await walk(root);
  const byExt = {};
  for (const file of files) {
    const ext = extname(file).toLowerCase() || "[none]";
    byExt[ext] = (byExt[ext] || 0) + 1;
  }

  const rootManifests = ["package.json","pyproject.toml","requirements.txt","netlify.toml","vercel.json","Dockerfile","README.md"]
    .filter((name) => files.includes(name));
  const nestedPackages = files.filter((f) => f.endsWith("/package.json"));
  const workflows = files.filter((f) => f.startsWith(".github/workflows/"));
  const tests = files.filter((f) => /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[^.]+$/i.test(f));
  const docs = files.filter((f) => /(^|\/)(docs?|documentation)(\/|$)/i.test(f) || f.endsWith(".md"));
  const instructions = files.filter((f) =>
    INSTRUCTION_NAMES.has(f.split("/").at(-1)) ||
    /(^|\/)\.cursor\/rules\//.test(f)
  );

  let corpus = "";
  let inspectedFiles = 0;
  let inspectedBytes = 0;
  for (const file of files) {
    if (!TEXT_EXT.has(extname(file).toLowerCase()) && !file.endsWith(".md")) continue;
    if (inspectedFiles >= 120 || inspectedBytes >= 1500000) break;
    const text = await safeRead(root, file);
    if (!text) continue;
    inspectedFiles += 1;
    inspectedBytes += text.length;
    corpus += `\n/* FILE: ${file} */\n${text}\n`;
  }

  const readme = await safeRead(root, "README.md");
  const netlify = await safeRead(root, "netlify.toml");
  const htmlFiles = files.filter((f) => f.endsWith(".html"));
  const jsFiles = files.filter((f) => /\.(m?js|cjs|ts|tsx|jsx)$/.test(f));

  const profile = {
    schemaVersion: 1,
    project: {
      root,
      fileCount: files.length,
      rootManifests,
      nestedPackages,
      languages: byExt,
      staticWeb: htmlFiles.length > 0 && files.some((f) => f.endsWith(".css")),
      rootNodePackage: files.includes("package.json"),
      nestedNodeTooling: nestedPackages.length > 0,
      academicDomain: /academic|akadem|citation|mentor|student|bibliograph|literatur|diplom/i.test(readme + corpus.slice(0, 200000))
    },
    ai: {
      uiPresent: /id=["']t-ai["']|Pitaj asistenta|ai-list|ai_query/i.test(corpus),
      cannedDemoResponses: /\bCANNED\b/.test(corpus),
      serverCallsPresent: /fetch\s*\(|XMLHttpRequest|axios\./i.test(corpus),
      providersReferenced: {
        openai: /openai/i.test(corpus),
        anthropic: /anthropic|claude/i.test(corpus),
        gemini: /gemini|google genai/i.test(corpus),
        openrouter: /openrouter/i.test(corpus),
        notdiamond: /notdiamond/i.test(corpus)
      },
      provenanceTracking: /ai_inserted|ai_query|ai_accept|provenien/i.test(corpus)
    },
    persistence: {
      localStorage: /localStorage/.test(corpus),
      indexedDB: /indexedDB/i.test(corpus),
      supabase: /supabase/i.test(corpus),
      firebase: /firebase/i.test(corpus),
      sql: /postgres|sqlite|mysql|CREATE TABLE/i.test(corpus),
      durableServerStorageDetected: /supabase|postgres|firebase|dynamodb|planetscale|neon/i.test(corpus)
    },
    deployment: {
      netlify: files.includes("netlify.toml"),
      netlifyFunctions: files.some((f) => f.startsWith("netlify/functions/")),
      vercel: files.includes("vercel.json"),
      docker: files.includes("Dockerfile"),
      githubActions: workflows.length > 0,
      publishDirectory: /publish\s*=\s*["']([^"']+)/.exec(netlify)?.[1] || null
    },
    testing: {
      testFiles: tests,
      workflowFiles: workflows,
      hasTests: tests.length > 0
    },
    security: {
      envUsage: /process\.env|import\.meta\.env/i.test(corpus),
      clientSecretRiskSignal: containsAny(corpus, [
        /\bsk-(?:proj-|ant-|or-v1-)?[A-Za-z0-9_-]{20,}/,
        /\bAIza[0-9A-Za-z_-]{20,}/
      ]),
      authSignals: /auth|login|session|jwt|oauth/i.test(corpus)
    },
    instructions: {
      files: instructions,
      documentationFiles: docs.slice(0, 60)
    },
    productSignals: {
      studentMode: /m-student|Student/.test(corpus),
      mentorMode: /m-mentor|Mentor/.test(corpus),
      citations: /citeStyle|bibEntry|Literatura/.test(corpus),
      comments: /comment_add|Komentar/.test(corpus),
      docx: /docx|ooxml/i.test(corpus)
    },
    inspection: {
      inspectedFiles,
      inspectedBytes,
      sampledSourceFiles: jsFiles.slice(0, 30)
    }
  };

  profile.summary = {
    runtimeShape: profile.project.staticWeb && !profile.deployment.netlifyFunctions ? "static-client-prototype" : "web-with-server-runtime",
    aiState: profile.ai.uiPresent && profile.ai.cannedDemoResponses && !profile.ai.serverCallsPresent
      ? "ai-ui-with-canned-demo-only"
      : profile.ai.serverCallsPresent
        ? "ai-server-call-detected"
        : "no-ai-ui-detected",
    persistenceState: profile.persistence.durableServerStorageDetected ? "durable-storage-detected" : "no-durable-storage-detected"
  };

  return profile;
}
