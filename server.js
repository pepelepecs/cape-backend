const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "256kb" }));

const DATA_FILE = path.join(__dirname, "data.json");

let db = {};
try {
  if (fs.existsSync(DATA_FILE)) {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) || {};
  }
} catch {
  db = {};
}

function saveDb() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch {}
}

// cleanup (např. 7 dní)
function cleanup() {
  const now = Date.now();
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  for (const [uuid, v] of Object.entries(db)) {
    const lastSeen = (v && v.lastSeen) ? Number(v.lastSeen) : 0;
    if (!lastSeen || now - lastSeen > maxAgeMs) delete db[uuid];
  }
}

app.get("/capes", (req, res) => {
  cleanup();
  res.json(db);
});

app.put("/capes/:uuid", (req, res) => {
  const uuid = req.params.uuid;
  const body = req.body || {};

  const clientKey = String(body.clientKey || "");
  if (!clientKey || clientKey.length < 16) {
    return res.status(400).json({ error: "missing clientKey" });
  }

  // auth: pokud už existuje záznam, clientKey musí sedět
  const existing = db[uuid];
  if (existing && existing.clientKey && existing.clientKey !== clientKey) {
    return res.status(403).json({ error: "clientKey mismatch" });
  }

  db[uuid] = {
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("cape-backend on port", port));
