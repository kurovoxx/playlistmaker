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
  console.log(`[DB Read] Checking usage for IP: ${ip}`);

  try {
    const rs = await db.execute({
      sql: "SELECT song_count FROM usage_stats WHERE ip = ? AND first_request_timestamp > ?",
      args: [ip, twentyFourHoursAgo],
    });

    if (rs.rows.length === 0) {
      console.log(`[DB Read] No recent record found for IP: ${ip}. Returning 0.`);
      return 0; // No recent usage found for this IP.
    }
    const count = rs.rows[0].song_count;
    console.log(`[DB Read] Found count: ${count} for IP: ${ip}`);
    return count;
  } catch (err) {
    console.error('Error getting usage count:', err);
    return 0; // Fail safe
  }
}

/**
 * Increments the usage count for a given IP address using a read-modify-write
 * pattern within a transaction to ensure atomicity and correctness.
 * @param {string} ip - The IP address of the user.
 * @param {number} songsToAdd - The number of songs to add to the count.
 * @returns {Promise<number>} The new usage count after incrementing.
 */
async function incrementUsage(ip, songsToAdd) {
  const db = getClient();
  const tx = await db.transaction("write");

  try {
    const now = Math.floor(Date.now() / 1000);
    const twentyFourHoursAgo = now - 86400;

    // 1. Read the existing record within the transaction
    const rs = await tx.execute({
      sql: "SELECT song_count, first_request_timestamp FROM usage_stats WHERE ip = ?",
      args: [ip],
    });

    let currentCount = 0;
    let newTimestamp = now;

    // 2. Decide the new values in plain JavaScript
    if (rs.rows.length > 0) {
      const record = rs.rows[0];
      // Check if the record is still within the 24-hour window
      if (record.first_request_timestamp > twentyFourHoursAgo) {
        currentCount = record.song_count;
        newTimestamp = record.first_request_timestamp; // Keep the original start time of the window
      }
      // If the record is old, we do nothing, letting currentCount remain 0 and newTimestamp be `now`.
    }

    const newCount = currentCount + songsToAdd;

    // 3. Execute a simple, clean UPSERT with the calculated values
    await tx.execute({
      sql: `
        INSERT INTO usage_stats (ip, song_count, first_request_timestamp)
        VALUES (?, ?, ?)
        ON CONFLICT(ip) DO UPDATE SET
          song_count = ?,
          first_request_timestamp = ?;
      `,
      args: [ip, newCount, newTimestamp, newCount, newTimestamp],
    });
    
    await tx.commit();
    return newCount;

  } catch (err) {
    console.error('Error in usage increment transaction:', err);
    // If the transaction is still active, roll it back
    if (tx && !tx.closed) {
      await tx.rollback();
    }
    throw err;
  }
}

module.exports = {
  setup,
  getUsageCount,
  incrementUsage,
};
