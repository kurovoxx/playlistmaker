// playlistmaker/server/storage/index.js

/*
 * This file acts as a "factory" for the storage provider.
 * It allows for easily swapping out the database implementation in the future 
 * without changing the main application logic.
 */

// We are now using the Turso provider.
const storageProvider = require('./turso');

// Export the provider's methods to be used by the application.
module.exports = storageProvider;
