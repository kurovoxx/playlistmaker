// playlistmaker/server/storage/turso.js
const { createClient } = require('@libsql/client');

let client;

function getClient() {
  if (client) {
    return client;
  }
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url || !token) {
    throw new Error('Turso database URL and Auth Token must be set in .env file.');
  }

  client = createClient({
    url,
    authToken: token,
  });
  
  console.log('🔗 Connected to Turso database.');
  return client;
}

/**
 * Creates the necessary table(s) in the database if they don't already exist.
 * This function is called once when the server starts.
 */
async function setup() {
  const db = getClient();
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS usage_stats (
        ip TEXT PRIMARY KEY,
        song_count INTEGER NOT NULL,
        first_request_timestamp INTEGER NOT NULL
      );
    `);
    console.log('✅ Database table "usage_stats" is ready.');
  } catch (err) {
    console.error('❌ Error setting up database table:', err);
    throw err;
  }
}

/**
 * Gets the current usage count for a given IP address.
 * Also checks if the 24-hour window has reset.
 * @param {string} ip - The IP address of the user.
 * @returns {Promise<number>} The current usage count.
 */
async function getUsageCount(ip) {
  const db = getClient();
  const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - 86400;

  try {
    const rs = await db.execute({
      sql: "SELECT song_count FROM usage_stats WHERE ip = ? AND first_request_timestamp > ?",
      args: [ip, twentyFourHoursAgo],
    });

    if (rs.rows.length === 0) {
      return 0; // No recent usage found for this IP.
    }
    return rs.rows[0].song_count;
  } catch (err) {
    console.error('Error getting usage count:', err);
    return 0; // Fail safe
  }
}

/**
 * Increments the usage count for a given IP address using an UPSERT operation.
 * If the user's record is expired or doesn't exist, it creates a new one.
 * @param {string} ip - The IP address of the user.
 * @param {number} songsToAdd - The number of songs to add to the count.
 * @returns {Promise<number>} The new usage count after incrementing.
 */
async function incrementUsage(ip, songsToAdd) {
  const db = getClient();
  const now = Math.floor(Date.now() / 1000);
  const twentyFourHoursAgo = now - 86400;

  try {
    // This is a more robust "UPSERT" operation using SQLite's `excluded` pseudo-table.
    // 1. It attempts to INSERT a new row for the IP.
    // 2. ON CONFLICT (if the IP already exists), it performs an UPDATE.
    // 3. The UPDATE logic checks if the existing record is older than 24 hours.
    //    - If old: It resets the count to `songsToAdd` (from `excluded.song_count`)
    //      and updates the timestamp to `now`.
    //    - If recent: It increments the existing `song_count`.
    await db.execute({
      sql: `
        INSERT INTO usage_stats (ip, song_count, first_request_timestamp)
        VALUES (?, ?, ?)
        ON CONFLICT(ip) DO UPDATE SET
          song_count = CASE
            WHEN usage_stats.first_request_timestamp < ? THEN excluded.song_count
            ELSE usage_stats.song_count + excluded.song_count
          END,
          first_request_timestamp = CASE
            WHEN usage_stats.first_request_timestamp < ? THEN excluded.first_request_timestamp
            ELSE usage_stats.first_request_timestamp
          END;
      `,
      args: [ip, songsToAdd, now, twentyFourHoursAgo, twentyFourHoursAgo],
    });

    // After the upsert, we get the definitive current count.
    return await getUsageCount(ip);

  } catch (err) {
    console.error('Error incrementing usage:', err);
    throw err;
  }
}

module.exports = {
  setup,
  getUsageCount,
  incrementUsage,
};
