const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres.zkwdoyvvdmajvlhnppej:Nimmacart%2414@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    const res = await pool.query('SELECT id, email, reset_token, reset_token_expires FROM users ORDER BY id DESC LIMIT 50');
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
})();
