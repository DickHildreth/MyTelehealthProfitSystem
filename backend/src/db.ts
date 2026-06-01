import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const db = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'affiliate_tracking',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASS     || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

db.on('error', (err) => {
  console.error('Unexpected DB pool error', err);
});

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const client = await db.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}
