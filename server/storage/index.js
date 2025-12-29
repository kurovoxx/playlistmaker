// playlistmaker/server/storage/index.js

/*
 * This file acts as a "factory" for the storage provider.
 * It allows for easily swapping out the database implementation in the future 
 * without changing the main application logic.
 *
 * To add a new storage provider (e.g., PostgreSQL):
 * 1. Create a new file in this directory, e.g., `postgres.js`.
 * 2. This new file must export functions with the same signature:
 *    - getUsageCount(ip)
 *    - incrementUsage(ip, songsToAdd)
 * 3. Add logic below to select the provider based on an environment variable,
 *    e.g., `process.env.STORAGE_TYPE`.
 */

// For now, we are defaulting to the Redis provider.
const storageProvider = require('./redis');

// Export the provider's methods to be used by the application.
module.exports = storageProvider;
