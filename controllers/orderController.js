const pool = require("../config/db");


// 🛒 CREATE ORDER
exports.createOrder = async (req, res) => {
  const { user_id, items } = req.body;

  if (!user_id || !items || items.length === 0) {
    return res.status(400).json({ message: "Invalid order data" });
  }

  try {
    let total = 0;

    for (let item of items) {
      const product = await pool.query(
        "SELECT * FROM products WHERE id=$1",
        [item.product_id]
      );

      if (product.rows.length === 0) {
        return res.status(404).json({
          message: `Product ID ${item.product_id} not found`
        });
      }

      const price = Number(product.rows[0].price);
      total += price * item.quantity;
    }

    const orderResult = await pool.query(
      `INSERT INTO orders (user_id, total)
       VALUES ($1, $2)
       RETURNING *`,
      [user_id, total]
    );

    const order = orderResult.rows[0];

    for (let item of items) {
      const product = await pool.query(
        "SELECT price FROM products WHERE id=$1",
        [item.product_id]
      );

      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
        [
          order.id,
          item.product_id,
          item.quantity,
          product.rows[0].price
        ]
      );
    }

    res.status(201).json({
      message: "Order created successfully ✅",
      order_id: order.id,
      total
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create order" });
  }
};


// 📦 GET ALL ORDERS
exports.getOrders = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM orders ORDER BY id DESC"
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
};


// 🔍 GET ORDER BY ID
exports.getOrderById = async (req, res) => {
  const { id } = req.params;

  try {
    const order = await pool.query(
      "SELECT * FROM orders WHERE id=$1",
      [id]
    );

    if (order.rows.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    const items = await pool.query(
      `SELECT oi.*, p.name
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id=$1`,
      [id]
    );

    res.json({
      order: order.rows[0],
      items: items.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch order" });
  }
};


// 🔄 UPDATE ORDER STATUS
exports.updateOrderStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatus = [
    "pending",
    "confirmed",
    "out_for_delivery",
    "delivered",
    "cancelled"
  ];

  if (!validStatus.includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  try {
    const result = await pool.query(
      "UPDATE orders SET status=$1 WHERE id=$2 RETURNING *",
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({
      message: "Order status updated ✅",
      data: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update status" });
  }
};


// 🚴 ASSIGN RIDER
exports.assignRider = async (req, res) => {
  const { id } = req.params;
  const { rider_name, rider_phone } = req.body;

  try {
    const result = await pool.query(
      `UPDATE orders 
       SET rider_name=$1, rider_phone=$2 
       WHERE id=$3 RETURNING *`,
      [rider_name, rider_phone, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({
      message: "Rider assigned 🚴",
      data: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to assign rider" });
  }
};


// 📍 UPDATE LOCATION (LIVE)
exports.updateLocation = async (req, res) => {
  const { id } = req.params;
  const { lat, lng } = req.body || {};

  if (!lat || !lng) {
    return res.status(400).json({ message: "lat and lng required" });
  }

  try {
    // ✅ DB UPDATE FIRST
    const result = await pool.query(
      `UPDATE orders SET lat=$1, lng=$2 WHERE id=$3 RETURNING *`,
      [lat, lng, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    // 🔥 EMIT LIVE LOCATION AFTER DB UPDATE
    const io = req.app.get("io");

    io.emit("orderLocationUpdate", {
      order_id: id,
      lat,
      lng
    });

    res.json({
      message: "Location updated 📍",
      data: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update location" });
  }
};