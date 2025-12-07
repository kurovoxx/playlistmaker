const { createClient } = require('@vercel/kv');
const { findYoutubeVideoId, generateWithOpenAI, getFallbackSongs, uniquePreserveOrder } = require('./api_calls');

const TOKEN_LIMIT = 50;
const TOKEN_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 horas

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

async function readUsage(ip) {
  const userData = await kv.get(ip);
  if (!userData) {
    return { count: 0, firstRequest: 0 };
  }
  const now = Date.now();
  if (now - userData.firstRequest > TOKEN_WINDOW_MS) {
    return { count: 0, firstRequest: 0 };
  }
  return userData;
}

async function handlePlaylistRequest(req, res, { markKeyAsExhausted, getNextYouTubeKey, currentKeyIndex, YOUTUBE_API_KEYS }) {
  const ip = req.ip;
  const numSongs = Number(req.body.numSongs) || 10;

  try {
    const now = Date.now();
    let userData = await kv.get(ip);

    if (!userData || (now - userData.firstRequest > TOKEN_WINDOW_MS)) {
      userData = {
        count: 0,
        firstRequest: now,
      };
    }

    if (userData.count + numSongs > TOKEN_LIMIT) {
      const remainingTokens = TOKEN_LIMIT - userData.count;
      return res.status(429).json({
        error: 'Límite de canciones excedido',
        message: `Has alcanzado tu límite de ${TOKEN_LIMIT} canciones en 24 horas.`,
        limit: TOKEN_LIMIT,
        remaining: remainingTokens < 0 ? 0 : remainingTokens,
      });
    }

    let { prompt } = req.body;

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({
        error: "Debes proporcionar una descripción de la playlist"
      });
    }

    const requestedSongs = numSongs < 1 ? 1 : (numSongs > 30 ? 30 : numSongs);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📝 Nueva solicitud: "${prompt}"`);
    console.log(`🔢 Canciones solicitadas: ${requestedSongs}`);
    console.log(`${'='.repeat(60)}`);

    let generated = [];
    let usedAI = false;

    try {
      generated = await generateWithOpenAI(prompt, requestedSongs);
      usedAI = true;
    } catch (err) {
      console.error('⚠️  OpenAI falló, usando fallback inteligente');
      generated = getFallbackSongs(prompt, requestedSongs);
    }

    if (generated.length < requestedSongs) {
      console.log(`⚠️  Faltan ${requestedSongs - generated.length} canciones, rellenando...`);
      const fallback = getFallbackSongs(prompt, requestedSongs);
      generated = [...generated, ...fallback.slice(0, requestedSongs - generated.length)];
      generated = uniquePreserveOrder(generated).slice(0, requestedSongs);
    }

    console.log(`\n✅ Canciones generadas (${generated.length}):`);
    generated.forEach((song, i) => console.log(`   ${i + 1}. ${song}`));

    console.log(`\n🔍 Buscando videos en YouTube...`);

    const searchPromises = generated.map(async (song) => {
      try {
        const videoId = await findYoutubeVideoId(song, 0, markKeyAsExhausted, getNextYouTubeKey, currentKeyIndex, YOUTUBE_API_KEYS);
        return {
          title: song,
          videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
          videoId,
          found: !!videoId,
        };
      } catch (err) {
        console.error(`   ✗ Error: ${song}`);
        return {
          title: song,
          videoUrl: null,
          videoId: null,
          found: false,
        };
      }
    });

    const items = await Promise.all(searchPromises);
    const videoIds = items.filter(i => i.videoId).map(i => i.videoId);

    console.log(`\n📊 Resultados:`);
    console.log(`   Videos encontrados: ${videoIds.length}/${generated.length}`);
    console.log(`   IA utilizada: ${usedAI ? 'OpenAI GPT-3.5' : 'Fallback inteligente'}`);
    console.log(`${'='.repeat(60)}\n`);

    if (videoIds.length === 0) {
      return res.status(404).json({
        error: "No se encontraron videos en YouTube para ninguna canción",
        items,
        songs: generated,
        usedAI
      });
    }

    const playlistUrl = `https://www.youtube.com/watch_videos?video_ids=${videoIds.join(',')}`;

    userData.count += generated.length;

    await kv.set(ip, userData);
    console.log(`📈 Tokens para ${ip}: ${userData.count}/${TOKEN_LIMIT}`);

    return res.json({
      success: true,
      playlistUrl,
      items,
      stats: {
        requested: numSongs,
        generated: generated.length,
        foundOnYoutube: videoIds.length,
        successRate: Math.round((videoIds.length / generated.length) * 100),
      },
      usedAI,
      message: videoIds.length === numSongs
        ? '¡Playlist generada exitosamente!'
        : `Playlist creada con ${videoIds.length} de ${numSongs} canciones`
    });

  } catch (err) {
    console.error("\n❌ ERROR DEL SERVIDOR:", err);
    return res.status(500).json({
      error: "Error al generar la playlist",
      details: err.message
    });
  }
}

module.exports = {
  handlePlaylistRequest,
  TOKEN_WINDOW_MS,
  readUsage,
  TOKEN_LIMIT,
};
