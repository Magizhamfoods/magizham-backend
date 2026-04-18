const pool = require("../config/db");
const jwt  = require("jsonwebtoken");

exports.register = async (req, res) => {
  const { name, phone, password } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO users (name, phone, password, role) VALUES ($1,$2,$3,'rider') RETURNING id, name, phone, role",
      [name, phone, password]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.login = async (req, res) => {
  const { phone, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE phone = $1", [phone]
    );
    if (!result.rows.length) return res.status(400).json({ message: "User not found" });

    const user = result.rows[0];
    if (user.password !== password) return res.status(400).json({ message: "Invalid password" });

    const token = jwt.sign(
      { id: user.id, phone: user.phone, role: user.role },
      process.env.JWT_SECRET || "magizham-dev-secret-2025"
    );
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};