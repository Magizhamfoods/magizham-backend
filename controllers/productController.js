const pool = require("../config/db");


// ➕ ADD PRODUCT
exports.addProduct = async (req, res) => {
  const { name, category, price, stock, image } = req.body;

  if (!name || price === undefined) {
    return res.status(400).json({ message: "Name and price are required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO products (name, category, price, stock, image)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, category || null, Number(price), stock || 0, image || null]
    );

    const product = result.rows[0];
    product.price = Number(product.price); // ✅ Fix numeric

    res.status(201).json({
      message: "Product created successfully ✅",
      data: product
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add product" });
  }
};



// 📦 GET ALL PRODUCTS
exports.getProducts = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM products ORDER BY id DESC"
    );

    const products = result.rows.map(p => ({
      ...p,
      price: Number(p.price)
    }));

    res.json({
      count: products.length,
      data: products
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
};



// 🔍 GET SINGLE PRODUCT
exports.getProductById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM products WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    const product = result.rows[0];
    product.price = Number(product.price);

    res.json(product);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch product" });
  }
};



// ✏️ UPDATE PRODUCT (Partial Update Supported)
exports.updateProduct = async (req, res) => {
  const { id } = req.params;
  const { name, category, price, stock, image } = req.body;

  try {
    const existing = await pool.query(
      "SELECT * FROM products WHERE id = $1",
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    const old = existing.rows[0];

    const updated = await pool.query(
      `UPDATE products
       SET name=$1, category=$2, price=$3, stock=$4, image=$5
       WHERE id=$6
       RETURNING *`,
      [
        name ?? old.name,
        category ?? old.category,
        price !== undefined ? Number(price) : old.price,
        stock ?? old.stock,
        image ?? old.image,
        id
      ]
    );

    const product = updated.rows[0];
    product.price = Number(product.price);

    res.json({
      message: "Product updated successfully ✅",
      data: product
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update product" });
  }
};



// ❌ DELETE PRODUCT
exports.deleteProduct = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM products WHERE id=$1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({
      message: "Product deleted successfully ✅"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete product" });
  }
};