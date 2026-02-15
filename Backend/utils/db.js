import pkg from "pg";
const { Pool } = pkg;

export const db = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT),
});

db.on("connect", () => {
  console.log("🟢 PostgreSQL connected");
});
