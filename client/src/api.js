// src/api.js

// Use environment variables or default to an empty string for relative paths
const PRIMARY_API_URL = process.env.REACT_APP_PRIMARY_API_URL || '';
const FALLBACK_API_URL = process.env.REACT_APP_FALLBACK_API_URL || '';
const REQUEST_TIMEOUT = 5000; // 5 seconds

export const fetchWithFallback = async (endpoint, options) => {
  const controller = new AbortController();
  const { signal } = controller;
  options = { ...options, signal };

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => {
      controller.abort();
      reject(new Error('Request timed out'));
    }, REQUEST_TIMEOUT)
  );

  // Try the primary URL first
  try {
    const response = await Promise.race([
      fetch(`${PRIMARY_API_URL}${endpoint}`, options),
      timeoutPromise,
    ]);
    if (response.ok) {
      return response;
    }
  } catch (error) {
    console.warn('Primary API failed, trying fallback:', error);
  }

  // If the primary URL fails or times out, try the fallback URL
  try {
    // We don't need a timeout for the fallback, but we'll remove the aborted signal
    const { signal, ...fallbackOptions } = options;
    const response = await fetch(`${FALLBACK_API_URL}${endpoint}`, fallbackOptions);
    return response;
  } catch (error) {
    console.error('Fallback API failed:', error);
    throw error; // Re-throw the error if both fail
  }
};
