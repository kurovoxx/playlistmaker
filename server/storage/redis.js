// playlistmaker/server/storage/redis.js
const Redis = require('ioredis');

// The client will automatically connect to the Redis instance using the REDIS_URL environment variable.
// It also has built-in reconnection logic.
const client = new Redis(process.env.REDIS_URL);

client.on('connect', () => {
  console.log('🔗 Connected to Redis database.');
});

client.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

const TOKEN_WINDOW_SECONDS = 24 * 60 * 60; // 24 hours in seconds

/**
 * Gets the current usage count for a given IP address.
 * @param {string} ip - The IP address of the user.
 * @returns {Promise<number>} The current usage count.
 */
async function getUsageCount(ip) {
  const usage = await client.get(`usage:${ip}`);
  return usage ? parseInt(usage, 10) : 0;
}

/**
 * Increments the usage count for a given IP address.
 * If the user has no previous usage, it sets the initial count and an expiration.
 * @param {string} ip - The IP address of the user.
 * @param {number} songsToAdd - The number of songs to add to the count.
 * @returns {Promise<number>} The new usage count after incrementing.
 */
async function incrementUsage(ip, songsToAdd) {
  const key = `usage:${ip}`;
  
  // Use a transaction to handle the case where the key might not exist yet.
  const multi = client.multi();
  multi.incrby(key, songsToAdd);
  multi.expire(key, TOKEN_WINDOW_SECONDS, 'NX'); // 'NX' sets expiration only if the key has no expiry
  
  const results = await multi.exec();
  
  // The result of INCRBY is the first element in the transaction results.
  const newCount = results[0][1];

  return newCount;
}

module.exports = {
  getUsageCount,
  incrementUsage,
  // Expose the client for potential direct use or testing if needed
  client, 
};
