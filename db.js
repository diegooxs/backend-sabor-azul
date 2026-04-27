const { Pool } = require('pg');
require('dotenv').config();

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  (process.env.DB_HOST &&
  process.env.DB_USER &&
  process.env.DB_PASSWORD &&
  process.env.DB_NAME
    ? `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME}`
    : null);

if (!connectionString) {
  throw new Error('No se encontró la configuración de PostgreSQL');
}

const usarSsl =
  process.env.DB_SSL === 'true' ||
  process.env.DB_SSL === '1' ||
  Boolean(process.env.DATABASE_URL) ||
  Boolean(process.env.POSTGRES_URL);

const poolConfig = {
  connectionString,
};

if (usarSsl) {
  poolConfig.ssl = {
    rejectUnauthorized: false,
  };
}

const pool = new Pool(poolConfig);

pool.on('connect', () => {
  console.log('Conexión a PostgreSQL establecida con éxito.');
});

module.exports = pool;
