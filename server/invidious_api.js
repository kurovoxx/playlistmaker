const https = require('https');

const INSTANCES = [
  'https://iv.melmac.space',
  'https://inv.projectsegfau.lt',
  'https://vid.puffyan.us',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacydev.net',
];

/**
 * Finds a video ID on Invidious for a given search query.
 * @param {string} q The search query (e.g., "Queen - Bohemian Rhapsody").
 * @param {number} timeout The timeout in milliseconds.
 * @returns {Promise<string|null>} The video ID or null if not found.
 */
async function findInvidiousVideoId(q, timeout = 3000) {
  const queries = [
    q,
    q.replace(/\s*-\s*/, ' '),
    `${q} official audio`,
    `${q} official video`,
  ];

  for (const instance of INSTANCES) {
    try {
      for (const query of queries) {
        const videoId = await searchInvidious(instance, query, timeout);
        if (videoId) {
          console.log(`   ✓ Encontrado en ${instance}: videoId=${videoId}`);
          return videoId;
        }
      }
    } catch (error) {
      console.warn(`   ⚠️ Error con instancia ${instance}: ${error.message}`);
    }
  }

  console.log(`   ✗ No se encontró video para "${q}" en ninguna instancia de Invidious.`);
  return null;
}

/**
 * Searches a specific Invidious instance for a video.
 * @param {string} instance The base URL of the Invidious instance.
 * @param {string} query The search query.
 * @param {number} timeout The timeout in milliseconds.
 * @returns {Promise<string|null>} The video ID or null.
 */
function searchInvidious(instance, query, timeout) {
  return new Promise((resolve, reject) => {
    const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
    
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`La API de Invidious respondió con el código de estado ${res.statusCode}`));
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          const video = results.find(item => item.type === 'video');
          resolve(video ? video.videoId : null);
        } catch (e) {
          reject(new Error('Error al analizar la respuesta de Invidious.'));
        }
      });
    }).on('error', (e) => {
      reject(new Error(`Error al contactar la instancia de Invidious: ${e.message}`));
    });

    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error('La solicitud a Invidious ha caducado.'));
    });
  });
}

module.exports = { findInvidiousVideoId };
