const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_VLz6GegA1FOr@ep-twilight-sun-amvs59u3.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require',
    ssl: {
        rejectUnauthorized: false 
    }
});

pool.on('connect', () => {
  console.log('Conexión a PostgreSQL establecida con éxito.');
});

module.exports = pool;