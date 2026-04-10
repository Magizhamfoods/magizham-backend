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

// ── MAGIZHAM CONSTANTS ────────────────────────────────────────
const RESTAURANT_LAT = 25.2426266;
const RESTAURANT_LNG = 55.3026453;

// FIX 3: JWT_SECRET must be set in Railway environment variables.
// Never leave this as the hardcoded fallback in production.
// Railway → Variables → Add: JWT_SECRET=your-strong-random-secret
const JWT_SECRET = process.env.JWT_SECRET || "magizham-dev-secret-2025";

// ── DB write throttle per socket ──────────────────────────────
// Only write to DB every 5 seconds per socket (socket emits still go instantly)
const dbUpdateTimestamps = {};

// ── SOCKET.IO ─────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: false
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  allowUpgrades: true
});

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── AUTH MIDDLEWARE ───────────────────────────────────────────
// Protects status updates and location writes from fake requests.
function authMiddleware(req, res, next) {
  // Always allow the public read-only tracking endpoint
  if (req.method === "GET" && req.path.endsWith("/track")) return next();

  const header = req.headers.authorization || "";
  const token  = header.replace("Bearer ", "").trim();

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    req.rider = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ── SERVE STATIC FILES ────────────────────────────────────────
app.get("/i18n.js", (req, res) => {
  res.sendFile(path.join(__dirname, "i18n.js"));
});

// ── DB: AUTO-CREATE ALL TABLES ────────────────────────────────
pool.connect()
  .then(async () => {
    console.log("Database connected successfully ✅");

    // Main orders table
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

    // rider_locations with speed, heading, accuracy, updated_at
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

    // Safe migration: add new columns if table already existed without them
    await pool.query(`
      ALTER TABLE rider_locations
        ADD COLUMN IF NOT EXISTS speed      NUMERIC(5,1)  DEFAULT 0,
        ADD COLUMN IF NOT EXISTS heading    NUMERIC(5,1)  DEFAULT 0,
        ADD COLUMN IF NOT EXISTS accuracy   NUMERIC(6,1)  DEFAULT 40,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP     DEFAULT NOW()
    `);

    // Seed test order (only inserts if id=1 does not exist yet)
    await pool.query(`
      INSERT INTO orders
        (id, user_id, total, status, rider_name, rider_phone, lat, lng, delivery_lat, delivery_lng)
      VALUES
        (1, 1, 45.50, 'on_the_way', 'Ravi Kumar', '971501234567',
         25.2426266, 55.3026453, 25.2320, 55.3120)
      ON CONFLICT (id) DO NOTHING
    `);

    console.log("Tables ready ✅");
  })
  .catch(err => console.error("DB connection error:", err));

// ── ROUTES ────────────────────────────────────────────────────
app.use("/api/auth",     authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders",   orderRoutes);

// ── SERVE PAGES ───────────────────────────────────────────────
app.get("/track/:orderId", (req, res) => {
  res.sendFile(path.join(__dirname, "tracking.html"));
});

app.get("/rider", (req, res) => {
  res.sendFile(path.join(__dirname, "rider.html"));
});

// ── TRACKING API (public — customers read their own order) ────
app.get("/api/orders/:id/track", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, user_id, total, status, created_at,
              rider_name, rider_phone, lat, lng,
              delivery_lat, delivery_lng
       FROM orders WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Track fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── UPDATE ORDER STATUS (protected) ──────────────────────────
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
    res.json({ success: true, orderId: id, status });
  } catch (err) {
    console.error("Status update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── RIDER LOCATION REST API (protected) ──────────────────────
// The rider app uses Socket.IO (faster), but this REST endpoint
// is useful for PowerShell testing and external integrations.
app.post("/api/rider/location", authMiddleware, async (req, res) => {
  const { orderId, lat, lng, speed, heading, accuracy } = req.body;

  if (lat == null || lng == null) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  const parsedLat  = parseFloat(lat);
  const parsedLng  = parseFloat(lng);
  const parsedSpd  = parseFloat(speed)    || 0;
  const parsedHdg  = parseFloat(heading)  || 0;
  const parsedAcc  = parseFloat(accuracy) || 40;

  if (isNaN(parsedLat) || isNaN(parsedLng)) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  try {
    if (orderId) {
      await pool.query(
        "UPDATE orders SET lat = $1, lng = $2 WHERE id = $3",
        [parsedLat, parsedLng, orderId]
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
        [orderId, parsedLat, parsedLng, parsedSpd, parsedHdg, parsedAcc]
      );

      io.to(`order_${orderId}`).emit("orderLocationUpdate", {
        lat:      parsedLat,
        lng:      parsedLng,
        speed:    parsedSpd,
        heading:  parsedHdg,
        accuracy: parsedAcc
      });

      console.log(`📍 REST: Order ${orderId} → ${parsedLat.toFixed(6)}, ${parsedLng.toFixed(6)} @ ${parsedSpd.toFixed(1)} km/h`);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Location REST error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── FIX 2: WEATHER PROXY — with 6s timeout ───────────────────
// Rider app fetches /api/weather instead of calling open-meteo directly.
// Added timeout so a hanging Open-Meteo response doesn't block the rider.
app.get("/api/weather", (req, res) => {
  const lat = parseFloat(req.query.lat) || RESTAURANT_LAT;
  const lon = parseFloat(req.query.lon) || RESTAURANT_LNG;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,relative_humidity_2m&timezone=Asia%2FDubai`;

  const request = https.get(url, (apiRes) => {
    let data = "";
    apiRes.on("data", chunk => data += chunk);
    apiRes.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "public, max-age=600"); // cache 10 min
        res.json(parsed);
      } catch (e) {
        if (!res.headersSent) res.status(502).json({ error: "Invalid weather response" });
      }
    });
  });

  // 6 second timeout — if Open-Meteo hangs, fail fast so rider gets seasonal fallback
  request.setTimeout(6000, () => {
    request.destroy();
    if (!res.headersSent) res.status(504).json({ error: "Weather API timeout" });
  });

  request.on("error", (e) => {
    console.error("Weather proxy error:", e.message);
    if (!res.headersSent) res.status(500).json({ error: "Weather API unavailable" });
  });
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status:  "✅ Running",
    uptime:  Math.floor(process.uptime()),
    version: "1.5.1",
    db:      "Railway PostgreSQL",
    endpoints: {
      track:   "/track/:orderId",
      rider:   "/rider",
      health:  "/api/health",
      weather: "/api/weather?lat=25.24&lon=55.30"
    }
  });
});

// ── FAVICON ───────────────────────────────────────────────────
app.get("/favicon.ico", (req, res) => res.status(204).end());

// ── SOCKET.IO ─────────────────────────────────────────────────
io.on("connection", async (socket) => {
  const type    = socket.handshake.query.type    || "unknown";
  const orderId = socket.handshake.query.orderId;

  // FIX 1: Safe orderId validation — parseInt(x) || 0 was broken
  // because parseInt("abc") = NaN, and NaN || 0 = 0, querying id=0
  // which always returns nothing, so riders never joined their room.
  if (orderId) {
    const numericId = parseInt(orderId, 10);

    if (isNaN(numericId)) {
      console.warn(`⚠️  [${type}] invalid orderId "${orderId}" — socket connected but not in room`);
    } else {
      try {
        const result = await pool.query(
          "SELECT id FROM orders WHERE id = $1 LIMIT 1",
          [numericId]
        );

        if (result.rows.length > 0) {
          socket.join(`order_${orderId}`);
          socket.orderId = orderId;
          console.log(`✅ [${type}] joined order_${orderId} | Socket: ${socket.id} | Transport: ${socket.conn.transport.name}`);
        } else {
          // Order doesn't exist yet — still connect, don't join room
          // Customer might be connecting before the order is created
          console.warn(`⚠️  [${type}] order_${orderId} not found — socket connected but not in room`);
        }
      } catch (err) {
        console.error("Socket room validation error:", err.message);
      }
    }
  } else {
    console.log(`✅ [${type}] connected | No order | Socket: ${socket.id}`);
  }

  // Confirm connection to client
  socket.emit("connected", {
    message: "Socket connected to Magizham",
    orderId:  orderId || null,
    socketId: socket.id
  });

  // ── Rider sends GPS location via socket ─────────────────────
  // Emits to customer room instantly (no throttle on socket events).
  // Writes to DB only every 5 seconds per socket (throttled).
  socket.on("riderLocationUpdate", async (data) => {
    const { lat, lng, orderId: oId, speed, heading, accuracy } = data;
    if (lat == null || lng == null) return;

    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (isNaN(parsedLat) || isNaN(parsedLng)) return;

    const parsedSpd = parseFloat(speed)    || 0;
    const parsedHdg = parseFloat(heading)  || 0;
    const parsedAcc = parseFloat(accuracy) || 40;

    // Always emit to customer tracking page instantly
    if (oId) {
      socket.to(`order_${oId}`).emit("orderLocationUpdate", {
        lat:      parsedLat,
        lng:      parsedLng,
        speed:    parsedSpd,
        heading:  parsedHdg,
        accuracy: parsedAcc
      });
    }

    // Throttle DB writes to every 5 seconds per socket
    const now    = Date.now();
    const lastDb = dbUpdateTimestamps[socket.id] || 0;

    if ((now - lastDb) >= 5000 && oId) {
      dbUpdateTimestamps[socket.id] = now;

      try {
        await pool.query(
          "UPDATE orders SET lat = $1, lng = $2 WHERE id = $3",
          [parsedLat, parsedLng, oId]
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
          [oId, parsedLat, parsedLng, parsedSpd, parsedHdg, parsedAcc]
        );

        console.log(`📍 Socket: Order ${oId} → ${parsedLat.toFixed(6)}, ${parsedLng.toFixed(6)}`);
      } catch (err) {
        console.error("Socket location DB write error:", err.message);
      }
    }

    // Confirm to rider that ping was received
    socket.emit("locationReceived", { lat: parsedLat, lng: parsedLng, ts: now });
  });

  // ── Rider or owner updates order status ─────────────────────
  socket.on("orderStatusUpdate", async (data) => {
    const { status, orderId: oId } = data;
    const allowed = ["placed", "confirmed", "on_the_way", "delivered"];

    if (!status || !allowed.includes(status)) {
      console.warn(`⚠️  Invalid status from socket: ${status}`);
      return;
    }

    try {
      await pool.query(
        "UPDATE orders SET status = $1 WHERE id = $2",
        [status, oId]
      );
      io.to(`order_${oId}`).emit("orderStatusUpdate", { orderId: oId, status });
      console.log(`📋 Socket: Order ${oId} → ${status}`);
    } catch (err) {
      console.error("Socket status update error:", err.message);
    }
  });

  // ── Rider sends SOS ──────────────────────────────────────────
  socket.on("riderSOS", (data) => {
    const { type: sosType, orderId: oId, lat, lng } = data;
    console.log(`🆘 SOS from Order ${oId}: ${sosType} at ${lat}, ${lng}`);
    io.to("owners").emit("riderSOS", { orderId: oId, type: sosType, lat, lng, ts: Date.now() });
  });

  // ── Order transfer between riders ────────────────────────────
  socket.on("orderTransfer", (data) => {
    const { orderId: oId, toRider } = data;
    console.log(`🔄 Order ${oId} transfer requested to rider ${toRider}`);
    io.to(`rider_${toRider}`).emit("orderTransferIncoming", { orderId: oId });
  });

  // ── Cleanup on disconnect ────────────────────────────────────
  socket.on("disconnect", (reason) => {
    delete dbUpdateTimestamps[socket.id];
    console.log(`❌ [${type}] disconnected | Order: ${orderId || "none"} | Reason: ${reason}`);
  });
});

// ── 404 FALLBACK ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Route not found", path: req.path });
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── START SERVER ──────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("🚀 Magizham Backend v1.5.1 running:");
  console.log(`👉 Local:   http://localhost:${PORT}`);
  console.log(`👉 Track:   http://localhost:${PORT}/track/1`);
  console.log(`👉 Rider:   http://localhost:${PORT}/rider`);
  console.log(`👉 Weather: http://localhost:${PORT}/api/weather?lat=25.24&lon=55.30`);
  console.log(`👉 Health:  http://localhost:${PORT}/api/health`);
  console.log("");
});