// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { handlePlaylistRequest, getUsage, TOKEN_LIMIT } = require('./user_usage_manager');
const { loadYouTubeKeys, getNextYouTubeKey, markKeyAsExhausted, YOUTUBE_API_KEYS, currentKeyIndex, keyUsageStats } = require('./youtube_token_manager');
const storage = require('./storage');

async function main() {
  // Setup the database connection and tables first.
  try {
    await storage.setup();
  } catch (err) {
    console.error('❌ Failed to set up storage. Server cannot start.');
    process.exit(1);
  }

  const app = express();
  const port = process.env.PORT || 5000;

  app.set('trust proxy', 1); // Confiar en el proxy para obtener la IP correcta

  // Validar que las API keys estén configuradas
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ ERROR: OPENAI_API_KEY no está configurada en .env');
    process.exit(1);
  }

  // Inicializar el cliente por primera vez
  getNextYouTubeKey();

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
    try {
      console.log(`[GET Request] API received request for usage from IP: ${req.ip}`);
      const usageData = await getUsage(req.ip);
      console.log(`[Server] Sending usage data:`, usageData);
      res.json(usageData);
    } catch (err) {
      console.error('Error fetching usage:', err);
      res.status(500).json({ error: 'Could not fetch usage data.' });
    }
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
}

main().catch(err => {
  console.error('CRITICAL SERVER ERROR:', err);
  process.exit(1);
});
