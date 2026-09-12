/**
 * Run ON EC2 (RDS is private):  node scripts/create-user.js email password "Full Name" developer
 */
import bcrypt from 'bcryptjs'
import { config } from '../src/config.js'
import { pool } from '../src/db.js'

const [email, password, fullName = 'Admin', role = 'developer'] = process.argv.slice(2)

const roles = new Set(['client', 'admin', 'developer'])

async function main() {
  if (!email || !password) {
    console.error('Usage: node scripts/create-user.js email password "Full Name" developer')
    process.exit(1)
  }
  if (password.length < 6) {
    console.error('Password must be at least 6 characters')
    process.exit(1)
  }
  if (!roles.has(role)) {
    console.error('Role must be client, admin, or developer')
    process.exit(1)
  }
  if (!config.databaseUrl) {
    console.error('DATABASE_URL is not set. Create backend/.env on this machine.')
    process.exit(1)
  }

  const password_hash = await bcrypt.hash(password, 12)
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       full_name = EXCLUDED.full_name,
       role = EXCLUDED.role
     RETURNING id, email, full_name, role`,
    [email.trim().toLowerCase(), password_hash, fullName.trim(), role]
  )
  console.log('User ready:', rows[0])
  console.log('Log in at http://localhost:5173/login with that email and password.')
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
