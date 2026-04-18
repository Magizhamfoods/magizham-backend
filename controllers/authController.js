const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

exports.login = async (req, res) => {
  const { phone, password } = req.body;  // ← was "email"

  try {
    const user = await pool.query(
      "SELECT * FROM users WHERE phone = $1",
      [phone]  // ← was "email"
    );

    if (user.rows.length === 0) {
      return res.status(400).json({ message: "User not found" });
    }

    // Plain text compare for now (password in DB is not hashed)
    const valid = user.rows[0].password === password;

    if (!valid) {
      return res.status(400).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { id: user.rows[0].id, phone: user.rows[0].phone, role: user.rows[0].role },
      process.env.JWT_SECRET || "magizham-dev-secret-2025"
    );

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};