import pg from 'pg'
import { config } from './config.js'

const { Pool } = pg

if (!config.databaseUrl) {
  console.warn('DATABASE_URL is not set')
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 20,
})

export async function query(text, params) {
  return pool.query(text, params)
}
