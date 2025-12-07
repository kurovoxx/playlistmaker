const { google } = require('googleapis');

let youtube;

function initializeYoutube(auth) {
  youtube = google.youtube({
    version: 'v3',
    auth,
  });
}

// Sistema de rotación de YouTube API Keys
// Formato: YOUTUBE_API_KEY1, YOUTUBE_API_KEY2, YOUTUBE_API_KEY3...
function loadYouTubeKeys() {
  const keys = [];
  let i = 1;

  while (process.env[`YOUTUBE_API_KEY${i}`]) {
    keys.push(process.env[`YOUTUBE_API_KEY${i}`]);
    i++;
  }

  console.log(`🔎 loadYouTubeKeys: cargadas ${keys.length} key(s).`);
  return keys;
}

const YOUTUBE_API_KEYS = loadYouTubeKeys();

if (YOUTUBE_API_KEYS.length === 0) {
  console.error('❌ ERROR: No hay YouTube API Keys configuradas en .env');
  console.error('Configura: YOUTUBE_API_KEY1=tu_key_1');
  console.error('          YOUTUBE_API_KEY2=tu_key_2');
  process.exit(1);
}

let currentKeyIndex = 0;
const keyUsageStats = YOUTUBE_API_KEYS.map((key, index) => ({
  key: key.substring(0, 10) + '...',
  index,
  requests: 0,
  errors: 0,
  quotaExhausted: false,
  lastUsed: null,
}));

// Función para obtener la siguiente API key y re-crear el cliente
function getNextYouTubeKey() {
    // Intentar encontrar una key que no esté agotada
    for (let i = 0; i < YOUTUBE_API_KEYS.length; i++) {
        const index = (currentKeyIndex + i) % YOUTUBE_API_KEYS.length;
        if (!keyUsageStats[index].quotaExhausted) {
            currentKeyIndex = index;
            keyUsageStats[index].requests++;
            keyUsageStats[index].lastUsed = new Date();

            // Re-crear la instancia de youtube con la nueva key
            initializeYoutube(YOUTUBE_API_KEYS[index]);

            // Logs de debugging
            console.log(`✅ Seleccionada API Key #${index + 1} (api${index + 1})`);
            console.log(`   -> api${index + 1} consumida. Tot requests: ${keyUsageStats[index].requests}`);
            console.log(`   -> Último uso: ${keyUsageStats[index].lastUsed.toISOString()}`);
            return YOUTUBE_API_KEYS[index];
        }
    }

    // Si todas están agotadas, resetear y usar la primera
    console.warn('⚠️  Todas las API keys están agotadas, reseteando...');
    keyUsageStats.forEach(stat => stat.quotaExhausted = false);
    currentKeyIndex = 0;
    keyUsageStats[0].requests++;
    keyUsageStats[0].lastUsed = new Date();

    // Re-crear la instancia con la primera key
    initializeYoutube(YOUTUBE_API_KEYS[0]);

    console.log('🔁 Reset completado. Usando API Key #1 (api1) tras reset.');
    return YOUTUBE_API_KEYS[0];
}

// Función para marcar una key como agotada
function markKeyAsExhausted() {
    const exhaustedKey = YOUTUBE_API_KEYS[currentKeyIndex];
    const index = YOUTUBE_API_KEYS.indexOf(exhaustedKey);

    if (index !== -1 && !keyUsageStats[index].quotaExhausted) {
        keyUsageStats[index].quotaExhausted = true;
        keyUsageStats[index].errors++;
        console.warn(`🔴 API Key #${index + 1} marcada como agotada (api${index + 1}). Errors tot: ${keyUsageStats[index].errors}`);

        // Rotar a la siguiente key
        currentKeyIndex = (index + 1) % YOUTUBE_API_KEYS.length;
        console.log(`🔄 Rotando a la API Key #${currentKeyIndex + 1} (api${currentKeyIndex + 1})`);
        getNextYouTubeKey(); // Llama para re-crear el cliente con la nueva key
    } else {
        console.warn('⚠️ markKeyAsExhausted: no se encontró índice válido o ya estaba marcado.');
    }
}

module.exports = {
  loadYouTubeKeys,
  getNextYouTubeKey,
  markKeyAsExhausted,
  YOUTUBE_API_KEYS,
  currentKeyIndex,
  keyUsageStats,
};
