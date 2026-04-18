/* ═══════════════════════════════════════════════════════════════
   MAGIZHAM BACKEND — server.js  PRODUCTION v1.7.0
   Fixes applied previously:
     ✅ AUTH: JWT required on all write routes — 401 on missing/bad token
     ✅ DB THROTTLE: Socket location writes every 5 s per socket.id
     ✅ CLEANUP: dbUpdateTimestamps removed on disconnect
     ✅ SOCKET GUARD: riderLocationUpdate rejects if data.orderId is missing
   New Features Added (v1.7.0):
     🚀 ETA ENGINE: Calculates distance to customer and returns ETA in mins
     🚦 STUCK DETECTION: Flags rider if moved < 50m in 3 minutes
     📍 GEOFENCING: Auto-detects 'at_restaurant' and 'arrived_at_customer' (150m radius)
═══════════════════════════════════════════════════════════════ */
require('dotenv').config();

const express    = require("express");
const cors       = require("cors");
const http       = require("http");
const https      = require("https");
const { Server } = require("socket.io");
const path       = require("path");
const jwt        = require("jsonwebtoken");

const pool           = require("./config/db");
const authRoutes     = require("./routes/authRoutes");
const productRoutes  = require("./routes/productRoutes");
const orderRoutes    = require("./routes/orderRoutes");

const app    = express();
const server = http.createServer(app);

// ── CONSTANTS ────────────────────────────────────────────────
const RESTAURANT_LAT = 25.2426266;
const RESTAURANT_LNG = 55.3026453;
const JWT_SECRET     = process.env.JWT_SECRET || "magizham-dev-secret-2025";

// ── ENGINE CONFIGURATIONS ────────────────────────────────────
const DB_WRITE_INTERVAL_MS = 5000;
const STUCK_TIME_MS        = 3 * 60 * 1000; // 3 minutes
const STUCK_RADIUS_KM      = 0.05;          // 50 meters
const GEOFENCE_RADIUS_KM   = 0.15;          // 150 meters
const AVG_CITY_SPEED_KMH   = 30;            // 30 km/h average speed for ETA

// ── IN-MEMORY STATE ──────────────────────────────────────────
const dbUpdateTimestamps = {}; // Key: socket.id, Value: timestamp
const activeDeliveries   = {}; // Key: orderId, Value: Tracking State Object
const fetchingDeliveries = {}; // Locks for DB queries

// ── HELPER: HAVERSINE DISTANCE ───────────────────────────────
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// ── SOCKET.IO ────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"], credentials: false },
  transports:     ["websocket", "polling"],
  allowEIO3:      true,
  pingTimeout:    60000,
  pingInterval:   25000,
  upgradeTimeout: 30000,
  allowUpgrades:  true
});

// ── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ── AUTH MIDDLEWARE — PRODUCTION ───────────────────────────── */
function authMiddleware(req, res, next) {
  if (req.method === "GET" && req.path.endsWith("/track")) return next();

  const header = (req.headers.authorization || "").trim();
  const token  = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized — Bearer token required" });
  }

  try {
    req.rider = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized — invalid or expired token" });
  }
}

// ── STATIC FILES ─────────────────────────────────────────────
app.get("/i18n.js", (req, res) => {
  res.sendFile(path.join(__dirname, "i18n.js"));
});

// ── DB: AUTO-CREATE ALL TABLES ───────────────────────────────
pool.connect()
  .then(async () => {
    console.log("✅ Database connected");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER,
        total        NUMERIC,
        status       VARCHAR(50)  DEFAULT 'placed',
        created_at   TIMESTAMP    DEFAULT NOW(),
        rider_name   VARCHAR(100),
        rider_phone  VARCHAR(20),
        lat          NUMERIC,
        lng          NUMERIC,
        delivery_lat NUMERIC,
        delivery_lng NUMERIC
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rider_locations (
        id         SERIAL PRIMARY KEY,
        order_id   VARCHAR(50) UNIQUE,
        lat        NUMERIC(10,7),
        lng        NUMERIC(10,7),
        speed      NUMERIC(5,1)  DEFAULT 0,
        heading    NUMERIC(5,1)  DEFAULT 0,
        accuracy   NUMERIC(6,1)  DEFAULT 40,
        updated_at TIMESTAMP     DEFAULT NOW()
      )
    `);

    await pool.query(`
      ALTER TABLE rider_locations
        ADD COLUMN IF NOT EXISTS speed      NUMERIC(5,1)  DEFAULT 0,
        ADD COLUMN IF NOT EXISTS heading    NUMERIC(5,1)  DEFAULT 0,
        ADD COLUMN IF NOT EXISTS accuracy   NUMERIC(6,1)  DEFAULT 40,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP     DEFAULT NOW()
    `);

    await pool.query(`
      INSERT INTO orders
        (id, user_id, total, status, rider_name, rider_phone, lat, lng, delivery_lat, delivery_lng)
      VALUES
        (1, 1, 45.50, 'on_the_way', 'Ravi Kumar', '971501234567',
         25.2426266, 55.3026453, 25.2320, 55.3120)
      ON CONFLICT (id) DO NOTHING
    `);

    console.log("✅ Tables ready");
  })
  .catch(err => console.error("❌ DB connection error:", err));

// ── ROUTE MODULES ────────────────────────────────────────────
app.use("/api/auth",     authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders",   orderRoutes);

// ── SERVE PAGES ──────────────────────────────────────────────
app.get("/track/:orderId", (req, res) =>
  res.sendFile(path.join(__dirname, "tracking.html")));

app.get("/rider", (req, res) =>
  res.sendFile(path.join(__dirname, "rider.html")));

// ── TRACKING API (public) ────────────────────────────────────
app.get("/api/orders/:id/track", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, total, status, created_at,
              rider_name, rider_phone, lat, lng,
              delivery_lat, delivery_lng
       FROM orders WHERE id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Order not found" });
    
    // Inject current tracking state if available in memory
    const data = result.rows[0];
    const trackingState = activeDeliveries[req.params.id];
    if (trackingState) {
        data.eta_mins = trackingState.etaMins;
        data.is_stuck = trackingState.isStuck;
        data.geofence = trackingState.geofence;
    }
    
    res.json(data);
  } catch (err) {
    console.error("Track fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── ORDER STATUS UPDATE (protected) ──────────────────────────
app.post("/api/orders/:id/status", authMiddleware, async (req, res) => {
  const { id }     = req.params;
  const { status } = req.body;
  const allowed    = ["placed", "confirmed", "on_the_way", "delivered"];

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: "Invalid status. Use: placed | confirmed | on_the_way | delivered" });
  }

  try {
    await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, id]);
    io.to(`order_${id}`).emit("orderStatusUpdate", { orderId: id, status });
    console.log(`📋 Order ${id} → ${status}`);
    
    // Cleanup state if delivered
    if (status === 'delivered') delete activeDeliveries[id];

    res.json({ success: true, orderId: id, status });
  } catch (err) {
    console.error("Status update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── RIDER LOCATION REST (protected) ──────────────────────────
app.post("/api/rider/location", authMiddleware, async (req, res) => {
  const { orderId, lat, lng, speed, heading, accuracy } = req.body;

  if (lat == null || lng == null) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  const pLat = parseFloat(lat);
  const pLng = parseFloat(lng);
  const pSpd = parseFloat(speed)    || 0;
  const pHdg = parseFloat(heading)  || 0;
  const pAcc = parseFloat(accuracy) || 40;

  if (isNaN(pLat) || isNaN(pLng)) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  try {
    if (orderId) {
      await pool.query(
        "UPDATE orders SET lat = $1, lng = $2 WHERE id = $3",
        [pLat, pLng, orderId]
      );
      await pool.query(
        `INSERT INTO rider_locations (order_id, lat, lng, speed, heading, accuracy, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (order_id) DO UPDATE
           SET lat        = EXCLUDED.lat,
               lng        = EXCLUDED.lng,
               speed      = EXCLUDED.speed,
               heading    = EXCLUDED.heading,
               accuracy   = EXCLUDED.accuracy,
               updated_at = NOW()`,
        [orderId, pLat, pLng, pSpd, pHdg, pAcc]
      );
      io.to(`order_${orderId}`).emit("orderLocationUpdate", {
        lat: pLat, lng: pLng, speed: pSpd, heading: pHdg, accuracy: pAcc
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Location REST error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ── ROUTES API PROXY ───────────────────────────────────────── */
app.get("/api/route", async (req, res) => {
  try {
    const { olat, olng, dlat, dlng } = req.query;

    if (!olat || !olng || !dlat || !dlng) {
      return res.status(400).json({ error: "Missing coordinates" });
    }

    const response = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask":
            "routes.duration,routes.staticDuration,routes.distanceMeters,routes.legs.steps.polyline.encodedPolyline"
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: { latitude: parseFloat(olat), longitude: parseFloat(olng) }
            }
          },
          destination: {
            location: {
              latLng: { latitude: parseFloat(dlat), longitude: parseFloat(dlng) }
            }
          },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
          departureTime: new Date().toISOString()
        })
      }
    );

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error("Route API error:", err);
    res.status(500).json({ error: "Route fetch failed" });
  }
});

/* ── WEATHER PROXY ───────────────────────────────────────────── */
app.get("/api/weather", (req, res) => {
  const lat = parseFloat(req.query.lat) || RESTAURANT_LAT;
  const lon = parseFloat(req.query.lon) || RESTAURANT_LNG;

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current_weather=true` +
    `&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,relative_humidity_2m` +
    `&timezone=Asia%2FDubai`;

  https.get(url, (apiRes) => {
    let raw = "";
    apiRes.on("data", chunk => raw += chunk);
    apiRes.on("end", () => {
      try {
        const parsed = JSON.parse(raw);
        res.setHeader("Content-Type",  "application/json");
        res.setHeader("Cache-Control", "public, max-age=600");
        res.json(parsed);
      } catch (e) {
        res.status(502).json({ error: "Invalid response from weather API" });
      }
    });
  }).on("error", (e) => {
    console.error("Weather proxy error:", e.message);
    res.status(500).json({ error: "Weather API unavailable" });
  });
});

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status:  "✅ Running",
    uptime:  Math.floor(process.uptime()),
    version: "1.7.0",
    db:      "PostgreSQL",
    engines: "ETA, Geofence, Stuck Detection Active",
    endpoints: {
      track:   "/track/:orderId",
      rider:   "/rider",
      health:  "/api/health"
    }
  });
});

app.get("/favicon.ico", (req, res) => res.status(204).end());

// ── SOCKET.IO ────────────────────────────────────────────────
io.on("connection", async (socket) => {
  const type    = socket.handshake.query.type    || "unknown";
  const orderId = socket.handshake.query.orderId;

  if (orderId) {
    try {
      const result = await pool.query(
        "SELECT id FROM orders WHERE id = $1 LIMIT 1",
        [parseInt(orderId, 10) || 0]
      );
      if (result.rows.length > 0) {
        socket.join(`order_${orderId}`);
        socket.orderId = orderId;
        console.log(`✅ [${type}] joined order_${orderId} | ${socket.id}`);
      }
    } catch (err) {
      console.error("Socket room validation:", err.message);
    }
  }

  socket.emit("connected", { message: "Socket connected to Magizham", orderId: orderId || null, socketId: socket.id });

  socket.on("riderLocationUpdate", async (data) => {
    if (!data || !data.orderId) return;

    const { lat, lng, orderId: oId, speed, heading, accuracy } = data;
    if (lat == null || lng == null) return;

    const pLat = parseFloat(lat);
    const pLng = parseFloat(lng);
    if (isNaN(pLat) || isNaN(pLng)) return;

    const pSpd = parseFloat(speed)    || 0;
    const pHdg = parseFloat(heading)  || 0;
    const pAcc = parseFloat(accuracy) || 40;
    const now  = Date.now();

    /* ==============================================================
       🚀 ENGINE LAYER: ETA, STUCK DETECTION, & GEOFENCING
       ============================================================== */
    
    // 1. Lazy-load delivery coordinates if not in memory
    if (!activeDeliveries[oId] && !fetchingDeliveries[oId]) {
        fetchingDeliveries[oId] = true;
        const lockTimeout = setTimeout(() => { delete fetchingDeliveries[oId]; }, 10000);
        pool.query('SELECT delivery_lat, delivery_lng FROM orders WHERE id = $1', [oId])
            .then(res => {
                if(res.rows.length && res.rows[0].delivery_lat) {
                    activeDeliveries[oId] = {
                        delLat: parseFloat(res.rows[0].delivery_lat),
                        delLng: parseFloat(res.rows[0].delivery_lng),
                        lastLat: pLat, lastLng: pLng, lastMoveTs: now,
                        isStuck: false, geofence: 'restaurant', etaMins: null
                    };
                }
            })
            .catch(e => console.error("Delivery fetch error:", e))
            .finally(() => {
                clearTimeout(lockTimeout);
                delete fetchingDeliveries[oId];
            });
    }

    let payloadEnrichments = {};
    const state = activeDeliveries[oId];

    if (state) {
        // --- 1. ETA ENGINE ---
        const distToCustKm = getDistanceKm(pLat, pLng, state.delLat, state.delLng);
        const roadDistKm = distToCustKm * 1.3; // 1.3x multiplier for road vs straight-line
        state.etaMins = Math.ceil((roadDistKm / AVG_CITY_SPEED_KMH) * 60);
        payloadEnrichments.etaMins = state.etaMins;

        // --- 2. GEOFENCING ---
        const distToRestKm = getDistanceKm(pLat, pLng, RESTAURANT_LAT, RESTAURANT_LNG);
        
        let newGeofence = state.geofence;
        if (distToCustKm <= GEOFENCE_RADIUS_KM) {
            newGeofence = 'arrived_at_customer';
        } else if (distToRestKm <= GEOFENCE_RADIUS_KM) {
            newGeofence = 'at_restaurant';
        } else {
            newGeofence = 'transit';
        }

        if (newGeofence !== state.geofence) {
            state.geofence = newGeofence;
            io.to(`order_${oId}`).emit("geofenceEvent", { status: state.geofence, orderId: oId });
            console.log(`📍 Geofence: Order ${oId} is now [${state.geofence}]`);
        }
        payloadEnrichments.geofence = state.geofence;

        // --- 3. STUCK DETECTION ---
        const distMovedKm = getDistanceKm(pLat, pLng, state.lastLat, state.lastLng);
        if (distMovedKm > STUCK_RADIUS_KM) {
            // Rider has moved meaningfully
            state.lastLat = pLat;
            state.lastLng = pLng;
            state.lastMoveTs = now;
            if (state.isStuck) {
                state.isStuck = false;
                io.to(`order_${oId}`).emit("stuckEvent", { status: 'moving', orderId: oId });
            }
        } else {
            // Rider hasn't moved meaningfully, check time
            if ((now - state.lastMoveTs) > STUCK_TIME_MS && !state.isStuck) {
                state.isStuck = true;
                io.to("owners").emit("riderAlert", { type: 'stuck', orderId: oId, lat: pLat, lng: pLng });
                io.to(`order_${oId}`).emit("stuckEvent", { status: 'stuck', orderId: oId });
                console.log(`⚠️ STUCK: Order ${oId} (No movement in 3 mins)`);
            }
        }
        payloadEnrichments.isStuck = state.isStuck;
    }
    /* ============================================================== */

    // Broadcast instantly to customer tracking page (with enrichments)
    if (oId) {
      socket.to(`order_${oId}`).emit("orderLocationUpdate", {
        lat: pLat, lng: pLng, speed: pSpd, heading: pHdg, accuracy: pAcc,
        ...payloadEnrichments
      });
    }

    // DB write throttle (every 5s)
    const lastDb = dbUpdateTimestamps[socket.id] || 0;
    if (oId && (now - lastDb) >= DB_WRITE_INTERVAL_MS) {
      dbUpdateTimestamps[socket.id] = now;
      try {
        await pool.query(
          "UPDATE orders SET lat = $1, lng = $2 WHERE id = $3",
          [pLat, pLng, oId]
        );
        await pool.query(
          `INSERT INTO rider_locations (order_id, lat, lng, speed, heading, accuracy, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (order_id) DO UPDATE
             SET lat        = EXCLUDED.lat,
                 lng        = EXCLUDED.lng,
                 speed      = EXCLUDED.speed,
                 heading    = EXCLUDED.heading,
                 accuracy   = EXCLUDED.accuracy,
                 updated_at = NOW()`,
          [oId, pLat, pLng, pSpd, pHdg, pAcc]
        );
      } catch (err) {
        console.error("Socket DB write error:", err.message);
      }
    }

    // Acknowledge to rider
    socket.emit("locationReceived", { lat: pLat, lng: pLng, ts: now });
  });

  socket.on("orderStatusUpdate", async (data) => {
    const { status, orderId: oId } = data;
    const allowed = ["placed", "confirmed", "on_the_way", "delivered"];
    if (!status || !allowed.includes(status)) return;
    try {
      await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, oId]);
      io.to(`order_${oId}`).emit("orderStatusUpdate", { orderId: oId, status });
      console.log(`📋 Socket: Order ${oId} → ${status}`);
      
      // Cleanup
      if (status === 'delivered') delete activeDeliveries[oId];
    } catch (err) {
      console.error("Socket status error:", err.message);
    }
  });

  socket.on("riderSOS", (data) => {
    console.log(`🆘 SOS: Order ${data.orderId} — ${data.type}`);
    io.to("owners").emit("riderSOS", { ...data, ts: Date.now() });
  });

  socket.on("orderTransfer", (data) => {
    console.log(`🔄 Transfer: Order ${data.orderId} → rider ${data.toRider}`);
    io.to(`rider_${data.toRider}`).emit("orderTransferIncoming", { orderId: data.orderId });
  });

  socket.on("disconnect", (reason) => {
    delete dbUpdateTimestamps[socket.id];
    console.log(`❌ [${type}] disconnected | Order: ${orderId || "none"} | ${reason}`);
  });
});

// ── 404 + ERROR HANDLER ──────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Route not found", path: req.path }));
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("🚀 Magizham Backend v1.7.0 — PRODUCTION");
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Auth: JWT required on all write routes`);
  console.log(`   Engines: ETA, Geofencing, Stuck Detection [ACTIVE]`);
  console.log("");
});