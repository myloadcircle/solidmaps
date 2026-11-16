// Patch: POST /api/feedback (proxy to SolidMaps D1 via service key) + guardrail flag.
const fs = require('fs');
const f = 'C:/DEV/mytruckroute-site/functions/api/[[path]].js';
let t = fs.readFileSync(f, 'utf8');
if (t.includes('handleFeedback')) {
  console.log('already patched');
  process.exit(0);
}

const block = [
  '',
  '// --- Driver suggestion box (satnav rollout) — proxied to the SolidMaps D1 table ---',
  'const FEEDBACK_CATEGORIES = new Set(["ukie", "eu", "global", "vehicle-profiles", "other"]);',
  '// Guardrail: verified-bridge AVOIDANCE (rerouting on located OSM restrictions) stays off',
  '// until the engine-side A/B proves it. Advisory listings are unaffected.',
  'const ENABLE_VERIFIED_BRIDGE_AVOIDANCE = false;',
  '',
  'async function handleFeedback(context) {',
  '  const { request, env } = context;',
  '  let body;',
  '  try {',
  '    body = await request.json();',
  '  } catch {',
  '    body = null;',
  '  }',
  '  const category = typeof body.category === "string" ? body.category : "";',
  '  const message = typeof body.message === "string" ? body.message.trim() : "";',
  '  if (!FEEDBACK_CATEGORIES.has(category)) {',
  '    return json({ error: "Pick a valid category" }, 400, corsHeaders(request));',
  '  }',
  '  if (message.length < 5 || message.length > 1000) {',
  '    return json({ error: "Tell us a little more (5-1000 characters)" }, 400, corsHeaders(request));',
  '  }',
  '  const email = normalizeEmail(body.email);',
  '  let tier = "anonymous";',
  '  if (email) {',
  '    const sub = await getSub(env, email);',
  '    tier = sub && sub.active ? "pro" : "free";',
  '  }',
  '  const upstream = await fetch(SOLIDMAPS_API + "/api/feedback", {',
  '    method: "POST",',
  '    headers: {',
  '      "Content-Type": "application/json",',
  '      "X-API-Key": env.SOLIDMAPS_API_KEY || "",',
  '    },',
  '    body: JSON.stringify({',
  '      category,',
  '      message,',
  '      app_source: "truckroute",',
  '      user_tier: tier,',
  '    }),',
  '  });',
  '  if (!upstream.ok) {',
  '    return json({ error: "Could not store the suggestion right now" }, 502, corsHeaders(request));',
  '  }',
  '  return json({ ok: true }, 200, corsHeaders(request));',
  '}',
  '',
].join('\n');

const anchor = 'function route(segments) {';
if (!t.includes(anchor)) throw new Error('route() anchor missing');
t = t.replace(anchor, block + '\n' + anchor);

// POST dispatcher
t = t.replace(
  'export async function onRequestPost(context) {\n  const name = route(context.params.path);\n  if (name === "webhook") return handleWebhook(context);',
  'export async function onRequestPost(context) {\n  const name = route(context.params.path);\n  if (name === "feedback") return handleFeedback(context);\n  if (name === "webhook") return handleWebhook(context);'
);
if (!t.includes('if (name === "feedback")')) throw new Error('post-dispatch anchor missing');

// route() table
t = t.replace(
  '  if (head === "solidmaps") return "solidmaps";',
  '  if (head === "solidmaps") return "solidmaps";\n  if (head === "feedback") return "feedback";'
);
if (!t.includes('if (head === "feedback")')) throw new Error('route-table anchor missing');

fs.writeFileSync(f, t);
console.log('feedback proxy installed');
