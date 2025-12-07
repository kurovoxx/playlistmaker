// server.js
const express = require('express');
const cors = require('cors');
const { initializeYoutube } = require('./api_calls');
const { handlePlaylistRequest, cleanupOldUsageData, TOKEN_WINDOW_MS, readUsage, TOKEN_LIMIT } = require('./token_manager');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.set('trust proxy', 1); // Confiar en el proxy para obtener la IP correcta

// Validar que las API keys estén configuradas
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ ERROR: OPENAI_API_KEY no está configurada en .env');
  process.exit(1);
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
    youtube = google.youtube({
        version: 'v3',
        auth: YOUTUBE_API_KEYS[0],
    });

    console.log('🔁 Reset completado. Usando API Key #1 (api1) tras reset.');
    return YOUTUBE_API_KEYS[0];
}

// Inicializar el cliente por primera vez
getNextYouTubeKey();

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

app.use(cors());
app.use(express.json());

// =========================
//      MAIN ENDPOINT
// =========================

app.post('/api/playlist', (req, res) => {
  handlePlaylistRequest(req, res, { markKeyAsExhausted, getNextYouTubeKey, currentKeyIndex, YOUTUBE_API_KEYS });
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const services = {
    youtube: YOUTUBE_API_KEYS.length > 0,
    openai: !!process.env.OPENAI_API_KEY,
  };

  // Test OpenAI connection
  let openaiStatus = 'not_configured';
  if (process.env.OPENAI_API_KEY) {
    try {
      // A simple call to check if the API key is valid
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        }
      });
      if (response.ok) {
        openaiStatus = 'working';
      } else {
        openaiStatus = 'invalid_key';
      }
    } catch (err) {
      openaiStatus = 'error';
    }
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services,
    openaiStatus,
    youtubeKeys: {
      total: YOUTUBE_API_KEYS.length,
      current: currentKeyIndex + 1,
      stats: keyUsageStats.map(stat => ({
        key: stat.key,
        requests: stat.requests,
        errors: stat.errors,
        exhausted: stat.quotaExhausted,
        lastUsed: stat.lastUsed,
      })),
    },
  });
});

// Root endpoint
app.get('/api/usage', async (req, res) => {
  const ip = req.ip;
  const usage = await readUsage();
  const userData = usage[ip];
  const now = Date.now();

  let count = 0;
  if (userData && (now - userData.firstRequest < TOKEN_WINDOW_MS)) {
    count = userData.count;
  }

  res.json({
    count,
    limit: TOKEN_LIMIT,
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'Playlist Maker API',
    version: '2.0.0',
    endpoints: {
      health: 'GET /api/health',
      playlist: 'POST /api/playlist',
    },
  });
});

app.listen(port, () => {
  console.log('\n🚀 ================================');
  console.log('   Playlist Maker Server v2.0');
  console.log('   Powered by OpenAI + YouTube');
  console.log('================================');
  console.log(`✓ Server: http://localhost:${port}`);
  console.log(`✓ YouTube APIs: ${YOUTUBE_API_KEYS.length} key(s) configuradas`);
  console.log(`✓ OpenAI API: ${process.env.OPENAI_API_KEY ? '✅ Configurada' : '❌ Falta'}`);
  console.log('================================');
  console.log('\n🔑 YouTube API Keys:');
  YOUTUBE_API_KEYS.forEach((key, i) => {
    console.log(`   ${i + 1}. ${key.substring(0, 10)}...${key.substring(key.length - 4)}`);
  });
  console.log('\n💡 Endpoints disponibles:');
  console.log(`   GET  http://localhost:${port}/api/health`);
  console.log(`   POST http://localhost:${port}/api/playlist`);
  console.log('\n');
});

// Run cleanup every 24 hours
setInterval(cleanupOldUsageData, TOKEN_WINDOW_MS);
