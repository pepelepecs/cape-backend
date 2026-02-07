const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "256kb" }));

const DATA_FILE = path.join(__dirname, "data.json");

// Backward compatible DB:
let db = { capes: {}, emotes: {} };

try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) || {};
    if (raw && typeof raw === "object") {
      if (raw.capes || raw.emotes) {
        db.capes = raw.capes && typeof raw.capes === "object" ? raw.capes : {};
        db.emotes = raw.emotes && typeof raw.emotes === "object" ? raw.emotes : {};
      } else {
        db.capes = raw;
        db.emotes = {};
      }
    }
  }
} catch {
  db = { capes: {}, emotes: {} };
}

function saveDb() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch {}
}

// cleanup capes (např. 7 dní)
function cleanupCapes() {
  const now = Date.now();
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  for (const [uuid, v] of Object.entries(db.capes)) {
    const lastSeen = (v && v.lastSeen) ? Number(v.lastSeen) : 0;
    if (!lastSeen || now - lastSeen > maxAgeMs) delete db.capes[uuid];
  }
}

function cleanupEmotes() {
  const now = Date.now();
  const maxAgeMs = 30 * 1000;     
  const maxRunMs = 20 * 1000;      
  for (const [uuid, v] of Object.entries(db.emotes)) {
    if (!v) { delete db.emotes[uuid]; continue; }

    const lastSeen = v.lastSeen ? Number(v.lastSeen) : 0;
    const startedAt = v.startedAt ? Number(v.startedAt) : 0;
    const active = (v.active !== false);

    if (!active) {
      if (!lastSeen || now - lastSeen > 3000) delete db.emotes[uuid];
      continue;
    }

    if (!lastSeen || now - lastSeen > maxAgeMs) { delete db.emotes[uuid]; continue; }
    if (startedAt && now - startedAt > maxRunMs) { delete db.emotes[uuid]; continue; }
  }
}

app.get("/", (req, res) => {
  res.status(200).send("ok");
});

// -------------------- CAPES API --------------------

app.get("/capes", (req, res) => {
  cleanupCapes();
  res.json(db.capes);
});

app.put("/capes/:uuid", (req, res) => {
  const uuid = req.params.uuid;
  const body = req.body || {};

  const clientKey = String(body.clientKey || "");
  if (!clientKey || clientKey.length < 16) {
    return res.status(400).json({ error: "missing clientKey" });
  }

  const existing = db.capes[uuid];
  if (existing && existing.clientKey && existing.clientKey !== clientKey) {
    return res.status(403).json({ error: "clientKey mismatch" });
  }

  db.capes[uuid] = {
    name: String(body.name || ""),
    capeId: String(body.capeId || "default"),
    customUrl: String(body.customUrl || ""),
    enabled: !!body.enabled,
    clientKey,
    lastSeen: Number(body.lastSeen || Date.now())
  };

  saveDb();
  res.json({ ok: true });
});

// -------------------- EMOTES API --------------------

app.get("/emotes", (req, res) => {
  cleanupEmotes();
  res.json({ players: db.emotes });
});

app.put("/emotes/:uuid", (req, res) => {
  const uuid = String(req.params.uuid || "").trim();
  const body = req.body || {};

  const name = String(body.name || "");
  const type = String(body.type || "");
  const active = body.active !== false;

  const startedAt = Number(body.startedAt || Date.now());
  const now = Date.now();

  if (!uuid) return res.status(400).json({ error: "missing uuid" });
  if (!type) return res.status(400).json({ error: "missing type" });

  db.emotes[uuid] = {
    name,
    type,
    active,
    startedAt: Number.isFinite(startedAt) ? startedAt : now,
    lastSeen: now
  };

  saveDb();
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("cape-backend on port", port));
