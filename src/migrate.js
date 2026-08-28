import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.join(__dirname, '../db/schema.sql')

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  const sql = fs.readFileSync(schemaPath, 'utf8')
  await pool.query(sql)
  console.log('Schema applied successfully')
  await pool.end()
}

migrate().catch((err) => {
  console.error(err)
  process.exit(1)
})
