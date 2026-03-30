require('dotenv').config();

const express    = require("express");
const cors       = require("cors");
const http       = require("http");
const { Server } = require("socket.io");
const path       = require("path");

const pool           = require("./config/db");
const authRoutes     = require("./routes/authRoutes");
const productRoutes  = require("./routes/productRoutes");
const orderRoutes    = require("./routes/orderRoutes");
const authMiddleware = require("./middleware/authMiddleware");

const app    = express();
const server = http.createServer(app);

// ── SOCKET.IO ───────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ── MIDDLEWARE ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname))); // serve HTML + static files

// ✅ SERVE i18n.js EXPLICITLY (IMPORTANT)
app.get("/i18n.js", (req, res) => {
  res.sendFile(path.join(__dirname, "i18n.js"));
});

// ── DB CONNECTION ───────────────────────────────────────────
pool.connect()
  .then(() => console.log("Database connected successfully ✅"))
  .catch(err => console.error("DB error:", err));

// ── ROUTES ──────────────────────────────────────────────────
app.use("/api/auth",     authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders",   orderRoutes);

app.get("/api/protected", authMiddleware, (req, res) => {
  res.json({ message: "Protected route accessed ✅", user: req.user });
});

// ── SERVE PAGES ─────────────────────────────────────────────
app.get("/track/:orderId", (req, res) => {
  res.sendFile(path.join(__dirname, "tracking.html"));
});

app.get("/rider", (req, res) => {
  res.sendFile(path.join(__dirname, "rider.html"));
});

// ─────────────────────────────────────────────────────────────
// TRACKING API
// ─────────────────────────────────────────────────────────────

// GET order tracking
app.get("/api/orders/:id/track", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, user_id, total, status, created_at,
              rider_name, rider_phone, lat, lng
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

// UPDATE order status
app.post("/api/orders/:id/status", async (req, res) => {
  const { id }     = req.params;
  const { status } = req.body;

  const allowed = ["placed", "confirmed", "on_the_way", "delivered"];

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Invalid status` });
  }

  try {
    await pool.query(
      "UPDATE orders SET status = $1 WHERE id = $2",
      [status, id]
    );

    io.to(`order_${id}`).emit("orderStatusUpdate", { orderId: id, status });

    console.log(`📋 Order ${id} → ${status}`);

    res.json({ success: true });

  } catch (err) {
    console.error("Status update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// RIDER LOCATION API
app.post("/api/rider/location", async (req, res) => {
  const { orderId, lat, lng } = req.body;

  if (!lat || !lng) {
    return res.status(400).json({ error: "lat and lng required" });
  }

  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);

  if (isNaN(parsedLat) || isNaN(parsedLng)) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  try {
    if (orderId) {
      await pool.query(
        "UPDATE orders SET lat = $1, lng = $2 WHERE id = $3",
        [parsedLat, parsedLng, orderId]
      );

      io.to(`order_${orderId}`).emit("orderLocationUpdate", {
        lat: parsedLat,
        lng: parsedLng
      });

      console.log(`📍 Order ${orderId} → ${parsedLat}, ${parsedLng}`);
    }

    res.json({ success: true });

  } catch (err) {
    console.error("Location error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// HEALTH CHECK
app.get("/api/health", (req, res) => {
  res.json({
    status: "✅ Running",
    uptime: Math.floor(process.uptime())
  });
});

// ─────────────────────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  const type    = socket.handshake.query.type || "unknown";
  const orderId = socket.handshake.query.orderId;

  console.log(`✅ ${type} connected | Order: ${orderId || "none"}`);

  if (orderId) {
    socket.join(`order_${orderId}`);
  }

  // Rider GPS updates
  socket.on("riderLocationUpdate", async (data) => {
    const { lat, lng, orderId: oId } = data;

    if (!lat || !lng) return;

    try {
      await pool.query(
        "UPDATE orders SET lat = $1, lng = $2 WHERE id = $3",
        [lat, lng, oId]
      );

      socket.to(`order_${oId}`).emit("orderLocationUpdate", { lat, lng });

    } catch (err) {
      console.error("Socket location error:", err);
    }

    socket.emit("locationReceived", { lat, lng });
  });

  // Status update
  socket.on("orderStatusUpdate", async (data) => {
    const { status, orderId: oId } = data;

    try {
      await pool.query(
        "UPDATE orders SET status = $1 WHERE id = $2",
        [status, oId]
      );

      io.to(`order_${oId}`).emit("orderStatusUpdate", {
        orderId: oId,
        status
      });

    } catch (err) {
      console.error("Socket status error:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected");
  });
});

app.set("io", io);

// ── START SERVER ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log("");
  console.log("🚀 Server running:");
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`👉 Track: http://localhost:${PORT}/track/1`);
  console.log(`👉 Rider: http://localhost:${PORT}/rider`);
  console.log("");
});