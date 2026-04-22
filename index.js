const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("./db");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [
      username.trim(),
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "El usuario no existe" });
    }

    const user = result.rows[0];

    let hashParaComparar = user.password.replace(/^\$2y\$/, "$2b$");

    const match = await bcrypt.compare(password, hashParaComparar);
      
    if (match) {
      return res.json({ 
        rol: user.rol, 
        username: user.username,
        message: "¡Bienvenido!" 
      });
    }

    res.status(401).json({ message: "Contraseña incorrecta" });
  } catch (err) {
    console.error("Error en login:", err);
    res.status(500).json({ error: "Error interno en el servidor" });
  }
});

app.get("/api/usuarios", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, rol FROM users ORDER BY id ASC",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/usuarios", async (req, res) => {
  const { username, password, rol } = req.body;
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPass = await bcrypt.hash(password, salt);

    const result = await pool.query(
      "INSERT INTO users (username, password, rol) VALUES ($1, $2, $3) RETURNING id, username, rol",
      [username, hashedPass, rol],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "No se pudo crear el usuario" });
  }
});

app.post("/api/usuarios/:id", async (req, res) => {
  const { username, password, rol } = req.body;
  const { id } = req.params;
  console.log(`Actualizando usuario ID: ${id}`);

  try {
    if (password && password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      let hashedPass = await bcrypt.hash(password, salt);
      hashedPass = hashedPass.replace(/^\$2b\$/, "$2y$");

      await pool.query(
        "UPDATE users SET username=$1, password=$2, rol=$3 WHERE id=$4",
        [username, hashedPass, rol, id],
      );
    } else {
      await pool.query("UPDATE users SET username=$1, rol=$2 WHERE id=$3", [
        username,
        rol,
        id,
      ]);
    }
    res.json({ message: "Usuario actualizado correctamente" });
  } catch (err) {
    console.error("Error en UPDATE:", err);
    res.status(500).json({ error: "Error interno al actualizar" });
  }
});

app.delete("/api/usuarios/:id", async (req, res) => {
  console.log(`Eliminando ID: ${req.params.id}`);
  try {
    await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    res.json({ message: "Eliminado correctamente" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get("/api/platillos", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.nombre, p.descripcion, p.precio, p.imagen, c.nombre as categoria 
      FROM platillos p 
      JOIN categorias c ON p.categoria_id = c.id
      ORDER BY p.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener platillos" });
  }
});

app.post("/api/platillos", async (req, res) => {
  const { nombre, descripcion, precio, imagen, categoria_id } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO platillos (nombre, descripcion, precio, imagen, categoria_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [nombre, descripcion, precio, imagen, categoria_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error al crear platillo" });
  }
});

app.delete("/api/platillos/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM platillos WHERE id = $1", [req.params.id]);
    res.json({ message: "Platillo eliminado" });
  } catch (err) {
    res.status(500).json({ error: "Error al eliminar platillo" });
  }
});
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`\n==============================================`);
  console.log(` Servidor Sabor Azul (NODE) listo`);
  console.log(` Puerto: ${PORT}`);
  console.log(` Rutas registradas: LOGIN, GET, POST, DELETE`);
  console.log(`==============================================\n`);
});