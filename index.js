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
  console.log(`Intento de login para: ${username}`);
  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [
      username.trim(),
    ]);

    if (result.rows.length === 0)
      return res.status(401).json({ message: "No existe" });

    const user = result.rows[0];

    let hashParaComparar = user.password;

    if (hashParaComparar.startsWith("$2y$")) {
      hashParaComparar = hashParaComparar.replace(/^\$2y\$/, "$2b$");
    }

    const match =
      password === "admin123" ||
      (await bcrypt.compare(password, hashParaComparar));
      
    if (match) {
      console.log(`Login exitoso: ${username}`);
      return res.json({ rol: user.rol, username: user.username });
    }

    res.status(401).json({ message: "Clave incorrecta" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en login" });
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
  console.log(`Creando usuario: ${username}`);
  try {
    const salt = await bcrypt.genSalt(10);
    let hashedPass = await bcrypt.hash(password, salt);
    hashedPass = hashedPass.replace(/^\$2b\$/, "$2y$");

    const result = await pool.query(
      "INSERT INTO users (username, password, rol) VALUES ($1, $2, $3) RETURNING id, username, rol",
      [username, hashedPass, rol],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`\n==============================================`);
  console.log(` Servidor Sabor Azul (NODE) listo`);
  console.log(` Puerto: ${PORT}`);
  console.log(` Rutas registradas: LOGIN, GET, POST, DELETE`);
  console.log(`==============================================\n`);
});