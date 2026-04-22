CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS platillos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  descripcion TEXT,
  precio NUMERIC(10, 2) NOT NULL CHECK (precio >= 0),
  imagen TEXT,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id)
);
