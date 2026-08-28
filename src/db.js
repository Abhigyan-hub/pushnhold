import pg from 'pg'
import { config } from './config.js'

const { Pool, Client } = pg

if (!config.databaseUrl) {
  console.warn('DATABASE_URL is not set')
}

export function pgSsl() {
  return process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
}

export function maintenanceDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl)
  url.pathname = '/postgres'
  return url.toString()
}

export function databaseNameFromUrl(databaseUrl) {
  const name = new URL(databaseUrl).pathname.replace(/^\//, '').split('?')[0]
  return name || 'cascade'
}

export async function ensureDatabaseExists(databaseUrl) {
  const dbName = databaseNameFromUrl(databaseUrl)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbName)) {
    throw new Error(`Invalid database name in DATABASE_URL: ${dbName}`)
  }

  const client = new Client({
    connectionString: maintenanceDatabaseUrl(databaseUrl),
    ssl: pgSsl(),
  })
  await client.connect()
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (!rows.length) {
      await client.query(`CREATE DATABASE ${dbName}`)
      console.log(`Created database ${dbName}`)
    } else {
      console.log(`Database ${dbName} already exists`)
    }
  } finally {
    await client.end()
  }
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: pgSsl(),
  max: 20,
})

export async function query(text, params) {
  return pool.query(text, params)
}
