// Adds /api/solidmaps/directions/v5/mapbox/driving/{lon,lat;...} to the catch-all:
// server-side X-API-Key (never ships to the client), SolidMaps truck routing,
// response reshaped to the Mapbox v5 envelope the site bundle already parses.
const fs = require('fs');
const f = 'C:/DEV/mytruckroute-site/functions/api/[[path]].js';
let t = fs.readFileSync(f, 'utf8');
if (t.includes('solidmapsDirections')) { console.log('already patched'); process.exit(0); }

const block = `
// --- SolidMaps engine proxy (truck routing via X-API-Key, server-side only) ---
const SOLIDMAPS_API = "https://solidmaps-api.fbirele.workers.dev";

function solidmapsModifier(instruction) {
  const m = /\\\\b(sharp left|sharp right|slight left|slight right|uturn|left|right|straight)\\\\b/i.exec(instruction || "");
  return m ? m[1].toLowerCase().replace(/\\\\s+/g, "-") : "straight";
}

function solidmapsType(instruction) {
  const s = (instruction || "").toLowerCase();
  if (s.startsWith("depart")) return "depart";
  if (s.startsWith("arrive")) return "arrive";
  if (s.includes("roundabout")) return "roundabout";
  if (s.startsWith("continue")) return "continue";
  if (s.startsWith("merge")) return "merge";
  return "turn";
}

async function solidmapsDirections(context) {
  const { request, env } = context;
  const segments = context.params.path || [];
  // .../solidmaps/directions/v5/mapbox/driving/{lon,lat;lon,lat}
  const coordPart = segments.slice(5).join("/");
  const points = coordPart
    .split(";")
    .map((pair) => pair.split(",").map(Number))
    .filter((p) => p.length === 2 && isFinite(p[0]) && isFinite(p[1]))
    .map(([lon, lat]) => ({ lon, lat }));
  if (points.length < 2) {
    return json({ code: "InvalidInput", message: "Two or more coordinates required." }, 400, corsHeaders(request));
  }
  const dims = {};
  const q = new URL(request.url).searchParams;
  if (q.get("truck_height")) dims.height_m = Number(q.get("truck_height"));
  if (q.get("truck_weight_kg")) dims.weight_kg = Number(q.get("truck_weight_kg"));
  if (q.get("truck_axles")) dims.axle_count = Number(q.get("truck_axles"));
  const body = {
    origin: points[0],
    destination: points[points.length - 1],
    mode: "truck",
  };
  if (points.length > 2) body.waypoints = points.slice(1, -1);
  if (Object.keys(dims).length > 0) body.vehicle = dims;

  const upstream = await fetch(SOLIDMAPS_API + "/api/route", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": env.SOLIDMAPS_API_KEY || "",
    },
    body: JSON.stringify(body),
  });
  if (!upstream.ok) {
    return json({ code: "NoRoute", message: "Routing engine unavailable." }, 200, corsHeaders(request));
  }
  const route = await upstream.json();
  if (route.error) {
    return json({ code: "NoRoute", message: route.error }, 200, corsHeaders(request));
  }
  // A haversine fallback must never present a straight line as a truck route.
  if (route.provider === "haversine") {
    return json({ code: "NoRoute", message: "Truck routing is unavailable right now — try again shortly." }, 200, corsHeaders(request));
  }
  const steps = (route.steps || []).map((s) => ({
    distance: s.distance_meters || 0,
    name: "",
    maneuver: {
      instruction: s.instruction,
      type: solidmapsType(s.instruction),
      modifier: solidmapsModifier(s.instruction),
      location: s.location || null,
    },
  }));
  return json(
    {
      code: "Ok",
      routes: [
        {
          distance: route.distance_meters,
          duration: route.duration_seconds,
          geometry: route.geometry || { coordinates: [] },
          legs: [{ steps, summary: "" }],
        },
      ],
    },
    200,
    corsHeaders(request),
  );
}
`;

// Insert the block before the route() dispatcher.
const anchor = 'function route(segments) {';
if (!t.includes(anchor)) throw new Error('route() anchor missing');
t = t.replace(anchor, block + '\n' + anchor);

// Register the path and dispatch it in onRequestGet.
t = t.replace(
  '  if (head === "health") return "health";',
  '  if (head === "health") return "health";\n  if (head === "solidmaps") return "solidmaps";'
);
t = t.replace(
  '  if (name === "status") return handleStatus(context);',
  '  if (name === "solidmaps") return solidmapsDirections(context);\n  if (name === "status") return handleStatus(context);'
);
fs.writeFileSync(f, t);
console.log('proxy installed');
