const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const pool = require("./db");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const ESTADOS_PEDIDO = new Set([
  "Pendiente",
  "Preparando",
  "Entregado",
  "Cancelado",
]);

function normalizarTexto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

function obtenerFrontendUrl() {
  return process.env.FRONTEND_URL || "http://localhost:5173";
}

function crearTransporterCorreo() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function crearHtmlConfirmacionReserva(reserva) {
  return `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
      <h1 style="color: #1a365d;">Reserva recibida en Sabor Azul</h1>
      <p>Hola <strong>${reserva.nombre}</strong>, hemos recibido tu solicitud de reservación.</p>
      <table style="border-collapse: collapse; margin: 18px 0;">
        <tr><td style="padding: 6px 12px; font-weight: bold;">Fecha</td><td style="padding: 6px 12px;">${reserva.fecha}</td></tr>
        <tr><td style="padding: 6px 12px; font-weight: bold;">Hora</td><td style="padding: 6px 12px;">${reserva.hora}</td></tr>
        <tr><td style="padding: 6px 12px; font-weight: bold;">Personas</td><td style="padding: 6px 12px;">${reserva.personas}</td></tr>
        <tr><td style="padding: 6px 12px; font-weight: bold;">Estado</td><td style="padding: 6px 12px;">${reserva.estado}</td></tr>
      </table>
      <p>Te esperamos en Sabor Azul. Si necesitas cambiar algún dato, responde a este correo o contáctanos.</p>
      <p style="color: #6b7280; font-size: 13px;">Este correo fue generado automáticamente.</p>
    </div>
  `;
}

async function enviarCorreoConfirmacionReserva(reserva) {
  const transporter = crearTransporterCorreo();

  if (!transporter) {
    console.warn(
      "Correo de reserva no enviado: faltan SMTP_HOST, SMTP_USER o SMTP_PASS.",
    );
    return { enviado: false, motivo: "smtp_no_configurado" };
  }

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: reserva.email,
    subject: `Confirmación de reservación Sabor Azul - ${reserva.fecha} ${reserva.hora}`,
    text:
      `Hola ${reserva.nombre}, recibimos tu reservación para ${reserva.personas} persona(s) ` +
      `el ${reserva.fecha} a las ${reserva.hora}. Estado: ${reserva.estado}.`,
    html: crearHtmlConfirmacionReserva(reserva),
  });

  return { enviado: true };
}

async function enviarCorreoConfirmacionReservaConTimeout(
  reserva,
  timeoutMs = 8000,
) {
  let timeoutId;

  try {
    return await Promise.race([
      enviarCorreoConfirmacionReserva(reserva),
      new Promise((resolve) => {
        timeoutId = setTimeout(
          () => resolve({ enviado: false, motivo: "timeout_envio" }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function convertirNumero(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : NaN;
}

function obtenerCoordenadasRestaurante() {
  return {
    lat: Number(process.env.RESTAURANT_LAT || 17.062635),
    lng: Number(process.env.RESTAURANT_LNG || -96.727788),
  };
}

function obtenerMapsApiKey() {
  return (
    process.env.Maps_API_KEY ||
    process.env.MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    ""
  );
}

function mapearLugarGoogle(place) {
  return {
    place_id: place.place_id,
    nombre: place.name,
    direccion: place.vicinity || "",
    rating: place.rating || null,
    lat: place.geometry?.location?.lat,
    lng: place.geometry?.location?.lng,
    tipos: place.types || [],
  };
}

async function buscarLugaresCercanosGoogle(lat, lng) {
  const apiKey = obtenerMapsApiKey();

  if (!apiKey) {
    return [];
  }

  const tipos = ["museum", "park"];
  const resultados = [];
  const lugaresVistos = new Set();

  for (const tipo of tipos) {
    const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("location", `${lat},${lng}`);
    url.searchParams.set("radius", "2500");
    url.searchParams.set("type", tipo);
    url.searchParams.set("language", "es");

    const respuesta = await fetch(url);
    const datos = await respuesta.json();

    if (datos.status !== "OK" && datos.status !== "ZERO_RESULTS") {
      throw new Error(datos.error_message || `Google Places respondió ${datos.status}`);
    }

    for (const place of datos.results || []) {
      if (!place.place_id || lugaresVistos.has(place.place_id)) continue;

      const lugar = mapearLugarGoogle(place);

      if (Number.isFinite(lugar.lat) && Number.isFinite(lugar.lng)) {
        lugaresVistos.add(place.place_id);
        resultados.push(lugar);
      }
    }
  }

  return resultados
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 3);
}

function crearRecomendacionesPorClima(tempC) {
  if (tempC >= 25) {
    return {
      tipo: "calor",
      titulo: "Hace calor en Oaxaca",
      mensaje: "Te recomendamos bebidas frías, ensaladas y platillos frescos.",
      items: [
        {
          id: 201,
          nombre: "Agua fresca de temporada",
          descripcion: "Bebida fría ideal para refrescarte.",
          precio: 55,
          imagen:
            "https://images.unsplash.com/photo-1621263764928-df1444c5e859?w=300&q=80",
        },
        {
          id: 101,
          nombre: "Ensalada César",
          descripcion: "Lechuga fresca, aderezo artesanal y parmesano.",
          precio: 160,
          imagen:
            "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=300&q=80",
        },
        {
          id: 202,
          nombre: "Ceviche Sabor Azul",
          descripcion: "Camarón macerado en cítricos, fresco y ligero.",
          precio: 280,
          imagen:
            "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=300&q=80",
        },
      ],
    };
  }

  if (tempC <= 18) {
    return {
      tipo: "frio",
      titulo: "Clima fresco en Oaxaca",
      mensaje: "Hoy convienen café, sopas y platos calientes.",
      items: [
        {
          id: 203,
          nombre: "Café de olla",
          descripcion: "Café caliente con canela y piloncillo.",
          precio: 65,
          imagen:
            "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=300&q=80",
        },
        {
          id: 204,
          nombre: "Sopa de tortilla",
          descripcion: "Caldo caliente con tortilla crujiente y chile pasilla.",
          precio: 140,
          imagen:
            "https://images.unsplash.com/photo-1547592166-23ac45744acd?w=300&q=80",
        },
        {
          id: 205,
          nombre: "Mole de la casa",
          descripcion: "Platillo caliente con sabores tradicionales.",
          precio: 260,
          imagen:
            "https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=300&q=80",
        },
      ],
    };
  }

  return {
    tipo: "templado",
    titulo: "Clima agradable en Oaxaca",
    mensaje:
      "El día está ideal para especiales de la casa y experiencias del chef.",
    items: [
      {
        id: 103,
        nombre: "Exp. Tres Cocinas",
        descripcion: "Oaxaqueña, mexicana e internacional en una experiencia.",
        precio: 850,
        imagen:
          "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=300&q=80",
      },
      {
        id: 102,
        nombre: "Pizza Azul",
        descripcion: "Higos, jamón serrano y queso gorgonzola.",
        precio: 400,
        imagen:
          "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=300&q=80",
      },
      {
        id: 104,
        nombre: "Esferas de Cacao",
        descripcion: "Postre de cacao nativo con mousse de mamey.",
        precio: 220,
        imagen:
          "https://images.unsplash.com/photo-1639158924965-7be3bb57506b?w=300&q=80",
      },
    ],
  };
}

async function obtenerUsuarioGoogle(idToken) {
  const respuesta = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  const perfil = await respuesta.json();

  if (!respuesta.ok) {
    throw new Error(perfil.error_description || "Token de Google no válido");
  }

  if (
    process.env.GOOGLE_CLIENT_ID &&
    perfil.aud !== process.env.GOOGLE_CLIENT_ID
  ) {
    throw new Error("El token de Google no pertenece a este cliente");
  }

  if (perfil.email_verified !== "true" && perfil.email_verified !== true) {
    throw new Error("Google no confirmó el correo del usuario");
  }

  return {
    email: perfil.email,
    nombre: perfil.name || perfil.email,
    foto: perfil.picture || "",
  };
}

function validarPedido(payload) {
  const cliente = normalizarTexto(payload?.cliente);
  const estado = normalizarTexto(payload?.estado) || "Pendiente";
  const productos = Array.isArray(payload?.productos) ? payload.productos : [];
  const userId =
    payload?.user_id == null || payload.user_id === ""
      ? null
      : Number(payload.user_id);

  if (!cliente) {
    return { error: "El nombre del cliente es requerido" };
  }

  if (!ESTADOS_PEDIDO.has(estado)) {
    return { error: "El estado del pedido no es válido" };
  }

  if (!Array.isArray(productos) || productos.length === 0) {
    return { error: "El pedido debe incluir al menos un producto" };
  }

  if (userId !== null && !Number.isInteger(userId)) {
    return { error: "El usuario asociado al pedido no es válido" };
  }

  const productosNormalizados = [];

  for (const producto of productos) {
    const nombre = normalizarTexto(
      producto?.nombre ?? producto?.nombre_producto,
    );
    const cantidad = Number(producto?.cantidad);
    const precioUnitario = convertirNumero(
      producto?.precio ?? producto?.precio_unitario,
    );
    const platilloId =
      producto?.id == null || producto.id === "" ? null : Number(producto.id);

    if (!nombre) {
      return { error: "Todos los productos deben incluir nombre" };
    }

    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      return { error: `La cantidad del producto ${nombre} no es válida` };
    }

    if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
      return { error: `El precio del producto ${nombre} no es válido` };
    }

    if (platilloId !== null && !Number.isInteger(platilloId)) {
      return { error: `El identificador del producto ${nombre} no es válido` };
    }

    productosNormalizados.push({
      platillo_id: platilloId,
      nombre_producto: nombre,
      cantidad,
      precio_unitario: Number(precioUnitario.toFixed(2)),
      subtotal: Number((cantidad * precioUnitario).toFixed(2)),
    });
  }

  const totalCalculado = Number(
    productosNormalizados
      .reduce((acumulado, producto) => acumulado + producto.subtotal, 0)
      .toFixed(2),
  );
  const totalRecibido =
    payload?.total == null ? totalCalculado : convertirNumero(payload.total);

  if (!Number.isFinite(totalRecibido) || totalRecibido < 0) {
    return { error: "El total del pedido no es válido" };
  }

  if (Math.abs(totalCalculado - totalRecibido) > 0.01) {
    return { error: "El total del pedido no coincide con el detalle enviado" };
  }

  return {
    value: {
      cliente,
      estado,
      user_id: userId,
      total: totalCalculado,
      productos: productosNormalizados,
    },
  };
}

function mapearPedido(row) {
  return {
    id: Number(row.id),
    user_id: row.user_id == null ? null : Number(row.user_id),
    cliente: row.cliente,
    estado: row.estado,
    total: Number(row.total),
    fecha: row.fecha,
    created_at: row.created_at,
    updated_at: row.updated_at,
    productos: [],
  };
}

async function obtenerPedidos(params = []) {
  const result = await pool.query(
    `
      SELECT
        p.id,
        p.user_id,
        p.cliente,
        p.estado,
        p.total,
        COALESCE(p.fecha, p.created_at) AS fecha,
        p.created_at,
        p.updated_at,
        d.id AS detalle_id,
        d.platillo_id,
        d.nombre_producto,
        d.cantidad,
        d.precio_unitario,
        d.subtotal
      FROM pedidos p
      LEFT JOIN pedido_detalles d ON d.pedido_id = p.id
      WHERE 1 = 1
      ${params.length ? "AND p.id = $1" : ""}
      ORDER BY COALESCE(p.fecha, p.created_at) DESC, p.id DESC, d.id ASC
    `,
    params,
  );

  const pedidos = [];
  const pedidosPorId = new Map();

  for (const row of result.rows) {
    if (!pedidosPorId.has(row.id)) {
      const pedido = mapearPedido(row);
      pedidosPorId.set(row.id, pedido);
      pedidos.push(pedido);
    }

    if (row.detalle_id != null) {
      pedidosPorId.get(row.id).productos.push({
        id: Number(row.platillo_id ?? row.detalle_id),
        detalle_id: Number(row.detalle_id),
        platillo_id: row.platillo_id == null ? null : Number(row.platillo_id),
        nombre: row.nombre_producto,
        cantidad: Number(row.cantidad),
        precio: Number(row.precio_unitario),
        subtotal: Number(row.subtotal),
      });
    }
  }

  return pedidos;
}

async function obtenerPlatillosExistentes(client, productos) {
  const ids = productos
    .map((producto) => producto.platillo_id)
    .filter((id) => Number.isInteger(id));

  if (ids.length === 0) {
    return new Set();
  }

  const result = await client.query(
    "SELECT id FROM platillos WHERE id = ANY($1::int[])",
    [ids],
  );

  return new Set(result.rows.map((row) => Number(row.id)));
}

app.get("/api/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({
      ok: true,
      database: "connected",
      now: result.rows[0].now,
    });
  } catch (error) {
    console.error("Error en healthcheck:", error);
    res.status(500).json({
      ok: false,
      database: "error",
      error: error.message,
    });
  }
});

app.get("/api/clima-menu", async (_req, res) => {
  const ciudad = process.env.WEATHERAPI_CITY || "Oaxaca, Mexico";
  const apiKey = process.env.WEATHERAPI_KEY;

  if (!apiKey) {
    const tempC = 29;
    return res.json({
      fuente: "demo",
      ciudad,
      pais: "Mexico",
      temp_c: tempC,
      condicion: "Soleado",
      icono: "",
      recomendaciones: crearRecomendacionesPorClima(tempC),
    });
  }

  try {
    const url = new URL("https://api.weatherapi.com/v1/current.json");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("q", ciudad);
    url.searchParams.set("lang", "es");
    url.searchParams.set("aqi", "no");

    const respuesta = await fetch(url);
    const datos = await respuesta.json();

    if (!respuesta.ok) {
      throw new Error(
        datos.error?.message || "No se pudo consultar WeatherAPI",
      );
    }

    const tempC = Number(datos.current.temp_c);

    res.json({
      fuente: "weatherapi",
      ciudad: datos.location.name,
      pais: datos.location.country,
      temp_c: tempC,
      condicion: datos.current.condition?.text || "Clima no disponible",
      icono: datos.current.condition?.icon
        ? `https:${datos.current.condition.icon}`
        : "",
      recomendaciones: crearRecomendacionesPorClima(tempC),
    });
  } catch (error) {
    console.error("Error consultando WeatherAPI:", error);
    res.status(502).json({ error: "No se pudo consultar WeatherAPI" });
  }
});

app.get("/api/maps-config", (_req, res) => {
  const apiKey = obtenerMapsApiKey();

  if (!apiKey) {
    return res.status(500).json({
      error: "Falta configurar Maps_API_KEY en el backend",
    });
  }

  res.json({ apiKey });
});

app.post("/api/ruta-y-lugares", async (req, res) => {
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const restaurante = obtenerCoordenadasRestaurante();

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "Coordenadas inválidas" });
  }

  try {
    const osrmUrl = new URL(
      `https://router.project-osrm.org/route/v1/driving/${lng},${lat};${restaurante.lng},${restaurante.lat}`
    );
    osrmUrl.searchParams.set("overview", "full");
    osrmUrl.searchParams.set("geometries", "geojson");
    osrmUrl.searchParams.set("steps", "false");
    osrmUrl.searchParams.set("alternatives", "false");

    const [rutaRespuesta, lugares] = await Promise.all([
      fetch(osrmUrl),
      buscarLugaresCercanosGoogle(lat, lng),
    ]);
    const rutaDatos = await rutaRespuesta.json();

    if (!rutaRespuesta.ok || rutaDatos.code !== "Ok" || !rutaDatos.routes?.length) {
      throw new Error(rutaDatos.message || "No se pudo calcular la ruta");
    }

    const ruta = rutaDatos.routes[0];
    const polyline = (ruta.geometry?.coordinates || []).map(([pLng, pLat]) => ({
      lat: pLat,
      lng: pLng,
    }));

    res.json({
      origen: { lat, lng },
      destino: restaurante,
      ruta: {
        polyline,
        distancia_km: Number((ruta.distance / 1000).toFixed(2)),
        duracion_min: Math.round(ruta.duration / 60),
      },
      lugares,
    });
  } catch (error) {
    console.error("Error en ruta-y-lugares:", error);
    res.status(502).json({ error: "No se pudo calcular la ruta o consultar lugares cercanos" });
  }
});

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
        id: user.id,
        rol: user.rol,
        username: user.username,
        message: "¡Bienvenido!",
      });
    }

    res.status(401).json({ message: "Contraseña incorrecta" });
  } catch (err) {
    console.error("Error en login:", err);
    res.status(500).json({ error: "Error interno en el servidor" });
  }
});

app.post("/api/login-google", async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res
      .status(400)
      .json({ message: "No se recibió la credencial de Google" });
  }

  try {
    const perfilGoogle = await obtenerUsuarioGoogle(credential);
    const username = perfilGoogle.email.toLowerCase();
    const userResult = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username],
    );

    let user = userResult.rows[0];

    if (!user) {
      const passwordTemporal = await bcrypt.hash(
        `google:${username}:${Date.now()}`,
        10,
      );
      const nuevoUsuario = await pool.query(
        "INSERT INTO users (username, password, rol) VALUES ($1, $2, $3) RETURNING id, username, rol",
        [username, passwordTemporal, "cliente"],
      );
      user = nuevoUsuario.rows[0];
    }

    res.json({
      id: user.id,
      rol: user.rol,
      username: perfilGoogle.nombre,
      email: username,
      foto: perfilGoogle.foto,
      proveedor: "google",
      message: "Sesión iniciada con Google",
    });
  } catch (err) {
    console.error("Error en login-google:", err);
    res
      .status(401)
      .json({ message: err.message || "No se pudo iniciar sesión con Google" });
  }
});

app.post("/api/recuperar-password", async (req, res) => {
  const { username, nuevaPassword } = req.body;

  if (
    !username ||
    !username.trim() ||
    !nuevaPassword ||
    nuevaPassword.length < 6
  ) {
    return res.status(400).json({
      message:
        "Ingresa tu usuario y una nueva contraseña de al menos 6 caracteres",
    });
  }

  try {
    const userResult = await pool.query(
      "SELECT id FROM users WHERE username = $1",
      [username.trim()],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "El usuario no existe" });
    }

    const salt = await bcrypt.genSalt(10);
    let hashedPass = await bcrypt.hash(nuevaPassword, salt);
    hashedPass = hashedPass.replace(/^\$2b\$/, "$2y$");

    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPass,
      userResult.rows[0].id,
    ]);

    res.json({ message: "Contraseña actualizada correctamente" });
  } catch (err) {
    console.error("Error en recuperar-password:", err);
    res.status(500).json({ error: "Error interno al actualizar contraseña" });
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

app.get("/api/categorias", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, nombre FROM categorias ORDER BY id ASC",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener categorías" });
  }
});

app.get("/api/platillos", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.nombre, p.descripcion, p.precio, p.imagen, p.categoria_id, c.nombre as categoria 
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
      "INSERT INTO platillos (nombre, descripcion, precio, imagen, categoria_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre, descripcion, precio, imagen, categoria_id",
      [nombre, descripcion, precio, imagen, categoria_id],
    );

    const platillo = result.rows[0];
    const catResult = await pool.query(
      "SELECT nombre FROM categorias WHERE id = $1",
      [platillo.categoria_id],
    );

    if (catResult.rows.length > 0) {
      platillo.categoria = catResult.rows[0].nombre;
    }

    res.status(201).json(platillo);
  } catch (err) {
    console.error("Error en POST platillos:", err);
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

app.put("/api/platillos/:id", async (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, precio, imagen, categoria_id } = req.body;

  try {
    const result = await pool.query(
      "UPDATE platillos SET nombre=$1, descripcion=$2, precio=$3, imagen=$4, categoria_id=$5 WHERE id=$6 RETURNING id, nombre, descripcion, precio, imagen, categoria_id",
      [nombre, descripcion, precio, imagen, categoria_id, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Platillo no encontrado" });
    }

    const platillo = result.rows[0];
    const catResult = await pool.query(
      "SELECT nombre FROM categorias WHERE id = $1",
      [platillo.categoria_id],
    );

    if (catResult.rows.length > 0) {
      platillo.categoria = catResult.rows[0].nombre;
    }

    res.json(platillo);
  } catch (err) {
    console.error("Error en PUT platillos:", err);
    res.status(500).json({ error: "Error al actualizar platillo" });
  }
});

const seleccionarMensajesContacto = `
  SELECT
    id::int AS id,
    nombre,
    email,
    mensaje,
    TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') AS fecha
  FROM mensajes_contacto
`;

app.get("/api/mensajes-contacto", async (req, res) => {
  try {
    const result = await pool.query(
      `${seleccionarMensajesContacto} ORDER BY created_at DESC, id DESC`,
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error en GET mensajes-contacto:", err);
    res.status(500).json({ error: "Error al obtener mensajes de contacto" });
  }
});

app.post("/api/mensajes-contacto", async (req, res) => {
  const { nombre, email, mensaje } = req.body;

  if (
    !nombre ||
    !nombre.trim() ||
    !email ||
    !email.trim() ||
    !mensaje ||
    !mensaje.trim()
  ) {
    return res.status(400).json({ error: "Todos los campos son requeridos" });
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO mensajes_contacto (nombre, email, mensaje)
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [nombre.trim(), email.trim(), mensaje.trim()],
    );

    const mensajeCreado = await pool.query(
      `${seleccionarMensajesContacto} WHERE id = $1`,
      [result.rows[0].id],
    );

    res.status(201).json(mensajeCreado.rows[0]);
  } catch (err) {
    console.error("Error en POST mensajes-contacto:", err);
    res.status(500).json({ error: "Error al guardar mensaje de contacto" });
  }
});

app.delete("/api/mensajes-contacto/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM mensajes_contacto WHERE id = $1 RETURNING id",
      [req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Mensaje no encontrado" });
    }

    res.json({ message: "Mensaje eliminado correctamente" });
  } catch (err) {
    console.error("Error en DELETE mensajes-contacto:", err);
    res.status(500).json({ error: "Error al eliminar mensaje de contacto" });
  }
});

const seleccionarReservas = `
  SELECT
    id::int AS id,
    user_id,
    nombre,
    email,
    telefono,
    TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
    TO_CHAR(hora, 'HH24:MI') AS hora,
    personas,
    estado,
    created_at,
    updated_at
  FROM reservas
`;

async function obtenerReservaPorId(id) {
  const result = await pool.query(`${seleccionarReservas} WHERE id = $1`, [id]);
  return result.rows[0];
}

app.get("/api/reservas", async (req, res) => {
  try {
    const result = await pool.query(
      `${seleccionarReservas} ORDER BY fecha DESC, hora DESC`,
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error en GET reservas:", err);
    res.status(500).json({ error: "Error al obtener reservas" });
  }
});

app.post("/api/reservas", async (req, res) => {
  const {
    nombre,
    email,
    telefono,
    fecha,
    hora,
    personas,
    enviarConfirmacionEmail,
  } = req.body;

  try {
    if (!nombre || !email || !fecha || !hora || !personas) {
      return res.status(400).json({ error: "Todos los campos son requeridos" });
    }

    const telefonoReserva = normalizarTexto(telefono) || "No proporcionado";

    const result = await pool.query(
      "INSERT INTO reservas (nombre, email, telefono, fecha, hora, personas, estado) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [nombre, email, telefonoReserva, fecha, hora, personas, "pendiente"],
    );

    const reserva = await obtenerReservaPorId(result.rows[0].id);
    let correoConfirmacion = { enviado: false };

    if (enviarConfirmacionEmail) {
      try {
        correoConfirmacion =
          await enviarCorreoConfirmacionReservaConTimeout(reserva);
      } catch (emailError) {
        console.error("Error enviando confirmación de reserva:", emailError);
        correoConfirmacion = { enviado: false, motivo: "error_envio" };
      }
    }

    reserva.correoConfirmacion = correoConfirmacion;
    res.status(201).json(reserva);
  } catch (err) {
    console.error("Error en POST reservas:", err);
    res.status(500).json({ error: "Error al crear reserva" });
  }
});

app.put("/api/reservas/:id", async (req, res) => {
  const { id } = req.params;
  const { estado, nombre, email, telefono, fecha, hora, personas } = req.body;

  try {
    let query;
    let params;

    if (estado) {
      query =
        "UPDATE reservas SET estado=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING id";
      params = [estado, id];
    } else {
      query =
        "UPDATE reservas SET nombre=$1, email=$2, telefono=$3, fecha=$4, hora=$5, personas=$6, updated_at=CURRENT_TIMESTAMP WHERE id=$7 RETURNING id";
      params = [nombre, email, telefono, fecha, hora, personas, id];
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    const reserva = await obtenerReservaPorId(result.rows[0].id);
    res.json(reserva);
  } catch (err) {
    console.error("Error en PUT reservas:", err);
    res.status(500).json({ error: "Error al actualizar reserva" });
  }
});

app.delete("/api/reservas/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM reservas WHERE id = $1 RETURNING id",
      [req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    res.json({ message: "Reserva eliminada correctamente" });
  } catch (err) {
    console.error("Error en DELETE reservas:", err);
    res.status(500).json({ error: "Error al eliminar reserva" });
  }
});

app.get("/api/distancia-restaurante", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const restaurante = obtenerCoordenadasRestaurante();

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "Coordenadas inválidas" });
  }

  try {
    const osrmUrl = new URL(
      `https://router.project-osrm.org/route/v1/driving/${lng},${lat};${restaurante.lng},${restaurante.lat}`,
    );
    osrmUrl.searchParams.set("overview", "false");
    osrmUrl.searchParams.set("alternatives", "false");
    osrmUrl.searchParams.set("steps", "false");

    const respuesta = await fetch(osrmUrl);
    const datos = await respuesta.json();

    if (!respuesta.ok || datos.code !== "Ok" || !datos.routes?.length) {
      throw new Error(datos.message || "No se pudo calcular la ruta");
    }

    const ruta = datos.routes[0];

    res.json({
      proveedor: "OSRM",
      distancia_km: Number((ruta.distance / 1000).toFixed(2)),
      duracion_min: Math.round(ruta.duration / 60),
      origen: { lat, lng },
      destino: restaurante,
    });
  } catch (err) {
    console.error("Error consultando OSRM:", err);
    res
      .status(502)
      .json({ error: "No se pudo calcular la distancia al restaurante" });
  }
});

app.get("/api/pedidos", async (req, res) => {
  try {
    const pedidos = await obtenerPedidos();
    res.json(pedidos);
  } catch (err) {
    console.error("Error en GET pedidos:", err);
    res.status(500).json({ error: "Error al obtener pedidos" });
  }
});

app.get("/api/pedidos/:id", async (req, res) => {
  try {
    const pedidos = await obtenerPedidos([req.params.id]);
    const pedido = pedidos[0];

    if (!pedido) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    res.json(pedido);
  } catch (err) {
    console.error("Error en GET pedido por id:", err);
    res.status(500).json({ error: "Error al obtener el pedido" });
  }
});

app.post("/api/pedidos", async (req, res) => {
  const validacion = validarPedido(req.body);

  if (validacion.error) {
    return res.status(400).json({ error: validacion.error });
  }

  const { cliente, estado, total, user_id, productos } = validacion.value;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const platillosExistentes = await obtenerPlatillosExistentes(
      client,
      productos,
    );

    const pedidoResult = await client.query(
      `
        INSERT INTO pedidos (user_id, cliente, estado, total, fecha, created_at, updated_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      [user_id, cliente, estado, total],
    );

    const pedidoId = pedidoResult.rows[0].id;

    for (const producto of productos) {
      await client.query(
        `
          INSERT INTO pedido_detalles (
            pedido_id,
            platillo_id,
            nombre_producto,
            cantidad,
            precio_unitario,
            subtotal,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        [
          pedidoId,
          platillosExistentes.has(producto.platillo_id)
            ? producto.platillo_id
            : null,
          producto.nombre_producto,
          producto.cantidad,
          producto.precio_unitario,
          producto.subtotal,
        ],
      );
    }

    await client.query("COMMIT");

    const pedidos = await obtenerPedidos([pedidoId]);
    res.status(201).json(pedidos[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error en POST pedidos:", err);
    res.status(500).json({ error: "Error al crear pedido" });
  } finally {
    client.release();
  }
});

app.post("/api/pagos/checkout-sesion", async (req, res) => {
  const total = convertirNumero(req.body?.total);
  const productos = Array.isArray(req.body?.productos)
    ? req.body.productos
    : [];

  if (!Number.isFinite(total) || total <= 0 || productos.length === 0) {
    return res
      .status(400)
      .json({ error: "El pago debe incluir productos y un total válido" });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.json({
      proveedor: "Stripe Checkout",
      modo: "demo",
      checkout_url: null,
      message:
        "Pago simulado. Agrega STRIPE_SECRET_KEY en el backend para redirigir a Stripe Checkout.",
    });
  }

  try {
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set(
      "success_url",
      `${obtenerFrontendUrl()}/#/menu?checkout=success`,
    );
    params.set("cancel_url", `${obtenerFrontendUrl()}/#/menu?checkout=cancel`);

    productos.forEach((producto, index) => {
      params.set(
        `line_items[${index}][quantity]`,
        String(Number(producto.cantidad) || 1),
      );
      params.set(`line_items[${index}][price_data][currency]`, "mxn");
      params.set(
        `line_items[${index}][price_data][unit_amount]`,
        String(Math.max(1, Math.round(Number(producto.precio) * 100))),
      );
      params.set(
        `line_items[${index}][price_data][product_data][name]`,
        normalizarTexto(producto.nombre) || "Producto Sabor Azul",
      );
    });

    const respuesta = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    const datos = await respuesta.json();

    if (!respuesta.ok) {
      throw new Error(
        datos.error?.message || "No se pudo crear la sesión de Stripe",
      );
    }

    res.json({
      proveedor: "Stripe Checkout",
      modo: "real",
      session_id: datos.id,
      checkout_url: datos.url,
    });
  } catch (err) {
    console.error("Error creando sesión de Stripe:", err);
    res.status(502).json({ error: "No se pudo crear la sesión de pago" });
  }
});

app.put("/api/pedidos/:id", async (req, res) => {
  const { estado } = req.body;

  if (!ESTADOS_PEDIDO.has(estado)) {
    return res.status(400).json({ error: "El estado del pedido no es válido" });
  }

  try {
    const result = await pool.query(
      `
        UPDATE pedidos
        SET estado = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING id
      `,
      [estado, req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    const pedidos = await obtenerPedidos([result.rows[0].id]);
    res.json(pedidos[0]);
  } catch (err) {
    console.error("Error en PUT pedidos:", err);
    res.status(500).json({ error: "Error al actualizar pedido" });
  }
});

app.delete("/api/pedidos/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM pedido_detalles WHERE pedido_id = $1", [
      req.params.id,
    ]);
    const result = await client.query(
      "DELETE FROM pedidos WHERE id = $1 RETURNING id",
      [req.params.id],
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    await client.query("COMMIT");
    res.json({ message: "Pedido eliminado correctamente" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error en DELETE pedidos:", err);
    res.status(500).json({ error: "Error al eliminar pedido" });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n==============================================`);
    console.log(` Servidor Sabor Azul (NODE) listo`);
    console.log(` Puerto: ${PORT}`);
    console.log(` Rutas registradas: LOGIN, GET, POST, DELETE`);
    console.log(`==============================================\n`);
  });
}

module.exports = app;
