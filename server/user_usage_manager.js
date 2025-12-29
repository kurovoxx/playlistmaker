// playlistmaker/server/user_usage_manager.js
const storage = require('./storage');
const { findYoutubeVideoId, generateWithOpenAI, getFallbackSongs, uniquePreserveOrder } = require('./api_calls');

const TOKEN_LIMIT = 50;

/**
 * Gets the current usage for a given IP.
 * This is called by the GET /api/usage endpoint.
 * @param {string} ip - The user's IP address.
 * @returns {Promise<{count: number, limit: number}>}
 */
async function getUsage(ip) {
  const count = await storage.getUsageCount(ip);
  return {
    count,
    limit: TOKEN_LIMIT,
  };
}

async function handlePlaylistRequest(req, res, { markKeyAsExhausted, getNextYouTubeKey, currentKeyIndex, YOUTUBE_API_KEYS }) {
  const ip = req.ip;
  const numSongs = Number(req.body.numSongs) || 10;

  try {
    const currentCount = await storage.getUsageCount(ip);

    if (currentCount + numSongs > TOKEN_LIMIT) {
      const remainingTokens = TOKEN_LIMIT - currentCount;
      return res.status(429).json({
        error: 'Límite de canciones excedido',
        message: `Has alcanzado tu límite de ${TOKEN_LIMIT} canciones en 24 horas.`,
        limit: TOKEN_LIMIT,
        remaining: remainingTokens < 0 ? 0 : remainingTokens,
      });
    }

    const { prompt } = req.body;

    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: "Debes proporcionar una descripción de la playlist" });
    }

    const requestedSongs = numSongs < 1 ? 1 : (numSongs > 30 ? 30 : numSongs);

    console.log(`
${'='.repeat(60)}`);
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

    console.log(`
✅ Canciones generadas (${generated.length}):`);
    generated.forEach((song, i) => console.log(`   ${i + 1}. ${song}`));

    console.log(`
🔍 Buscando videos en YouTube...`);

    const searchPromises = generated.map((song) => 
      findYoutubeVideoId(song, 0, markKeyAsExhausted, getNextYouTubeKey, currentKeyIndex, YOUTUBE_API_KEYS)
        .then(videoId => ({
          title: song,
          videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
          videoId,
          found: !!videoId,
        }))
        .catch(err => {
          console.error(`   ✗ Error buscando "${song}": ${err.message}`);
          return { title: song, videoUrl: null, videoId: null, found: false };
        })
    );

    const items = await Promise.all(searchPromises);
    const videoIds = items.filter(i => i.videoId).map(i => i.videoId);

    console.log(`
📊 Resultados:`);
    console.log(`   Videos encontrados: ${videoIds.length}/${generated.length}`);
    console.log(`   IA utilizada: ${usedAI ? 'OpenAI GPT-3.5' : 'Fallback inteligente'}`);
    console.log(`${'='.repeat(60)}
`);

    if (videoIds.length === 0) {
      return res.status(404).json({
        error: "No se encontraron videos en YouTube para ninguna canción",
        items,
        songs: generated,
        usedAI
      });
    }
    
    // Atomically increment the usage count in Redis
    const newTotalCount = await storage.incrementUsage(ip, generated.length);
    console.log(`📈 Usage for ${ip}: ${newTotalCount}/${TOKEN_LIMIT}`);

    const playlistUrl = `https://www.youtube.com/watch_videos?video_ids=${videoIds.join(',')}`;

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
  getUsage, // <-- Changed from readUsage
  TOKEN_LIMIT,
};