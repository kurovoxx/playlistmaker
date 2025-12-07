// server.js
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const lockfile = require('proper-lockfile');
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

// Variable para mantener la instancia de YouTube
let youtube;

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
            youtube = google.youtube({
                version: 'v3',
                auth: YOUTUBE_API_KEYS[index],
            });

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

// OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());

// Parsear canciones del texto generado
function parseSongLines(text) {
  return text
    .split('\n')
    .map(line => {
      // Remover numeración: "1.", "1)", "1 -", etc.
      line = line.replace(/^\s*\d+[\).\-\s:]+/, '');
      // Remover asteriscos y guiones de markdown
      line = line.replace(/^[\*\-\s]+/, '');
      // Normalizar separadores
      line = line.replace(/\s+[—–]\s+/, ' - ');
      // Remover comillas
      line = line.replace(/["'`]/g, '');
      return line.trim();
    })
    .filter(line => {
      // Debe tener al menos 3 caracteres y contener un guión
      return line.length > 3 && line.includes('-');
    });
}

function uniquePreserveOrder(arr) {
  const seen = new Set();
  return arr.filter(x => {
    const k = x.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Búsqueda en YouTube con rotación automática de API keys
async function findYoutubeVideoId(q, retries = 0) {
    const queries = [
        q,
        q.replace(/\s*-\s*/, ' '),
        `${q} official audio`,
        `${q} official video`,
    ];

    for (const query of queries) {
        try {
            // Log: qué key (índice) estamos usando justo antes de la búsqueda
            console.log(`🔑 Buscando con api${currentKeyIndex + 1}: "${query}" (reintento ${retries})`);

            const resp = await youtube.search.list({
                part: 'snippet',
                q: query,
                type: 'video',
                maxResults: 1,
                videoCategoryId: '10', // Categoría de música
            });

            const item = resp?.data?.items?.[0];
            if (item?.id?.videoId) {
                console.log(`   ✓ Encontrado con api${currentKeyIndex + 1}: videoId=${item.id.videoId}`);
                return item.id.videoId;
            } else {
                console.log(`   ✗ No hay resultados con api${currentKeyIndex + 1} para "${query}"`);
            }
                } catch (e) {
            // Normalizar mensaje y obtener detalles estructurados
            const msg = (e && (e.message || e.toString())) ? (e.message || String(e)) : String(e);
            // Tratar de leer reason/errors desde la respuesta de Google (más fiable)
            const googleReason = (
              e?.errors?.[0]?.reason ||
              e?.response?.data?.error?.errors?.[0]?.reason ||
              e?.response?.data?.error?.message
            ) || '';

            console.warn(`   ⚠️ Error usando api${currentKeyIndex + 1} -> ${msg}`);
            if (googleReason) console.warn(`      -> googleReason: ${googleReason}`);

            // Detección robusta de 'quota exhausted' / rate limit:
            const lowerMsg = (msg + ' ' + googleReason).toLowerCase();
            const isQuota = /quota|quotaexceeded|userratelimitexceeded|ratelimitexceeded|dailyLimitExceeded/i.test(lowerMsg)
                          || e?.response?.status === 403
                          || googleReason.toLowerCase().includes('quota');

            if (isQuota) {
                console.warn(`   🔥 quota detectada para api${currentKeyIndex + 1} (rotando)...`);
                markKeyAsExhausted(); // Marcar la key actual como agotada

                // Reintentar con la siguiente key si hay más disponibles
                if (retries < YOUTUBE_API_KEYS.length - 1) {
                    console.log(`🔄 Reintentando con la nueva API key... (reintento ${retries + 1})`);
                    return await findYoutubeVideoId(q, retries + 1);
                } else {
                    console.error('❌ Todas las API keys de YouTube están agotadas');
                    return null;
                }
            }

            // Error específico: Data API no habilitada para la key
            if (lowerMsg.includes('has not been used') || lowerMsg.includes('not been used')) {
                console.error('❌ YouTube Data API v3 no está habilitada para esta key');
                markKeyAsExhausted();
                if (retries < YOUTUBE_API_KEYS.length - 1) {
                    return await findYoutubeVideoId(q, retries + 1);
                }
            }

            // Otros errores: loguear y continuar con siguiente query del mismo key
            console.warn(`⚠️  Error buscando "${query}":`, msg);
        }

    }
    return null;
}

// Generar canciones con OpenAI
async function generateWithOpenAI(prompt, numSongs) {
  try {
    console.log('🤖 Generando canciones con OpenAI GPT-3.5...');
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Eres un experto curador musical con conocimiento profundo de música de todos los géneros y épocas. Tu trabajo es generar listas de canciones precisas, relevantes y de alta calidad.

REGLAS CRÍTICAS DE FORMATO:
- Formato EXACTO: "Artista - Título de Canción" (con espacios alrededor del guión)
- Una canción por línea
- Sin numeración (no 1., no 1), no *), sin viñetas, sin asteriscos
- Sin explicaciones, sin texto introductorio, sin texto final
- Solo las líneas de canciones

REGLAS DE CONTENIDO:
- Solo canciones reales, populares y fáciles de encontrar en YouTube
- Diversifica artistas (máximo 2 canciones del mismo artista)
- Ajusta el idioma según el contexto (español/inglés/otro según la solicitud)
- Si mencionan un género específico, sé muy preciso con ese género
- Si mencionan una época (70s, 80s, 90s), respeta esa época
- Si mencionan un mood (triste, alegre, energético), ajusta la selección

EJEMPLOS DE FORMATO CORRECTO:
Queen - Bohemian Rhapsody
Los Bunkers - Ven Aquí
The Beatles - Hey Jude
Soda Stereo - De Música Ligera

NO HAGAS ESTO (formato incorrecto):
1. Queen - Bohemian Rhapsody
* The Beatles - Hey Jude
- Pink Floyd - Wish You Were Here
"Nirvana - Smells Like Teen Spirit"` 
        },
        {
          role: "user",
          content: `Genera EXACTAMENTE ${numSongs} canciones que coincidan perfectamente con esta solicitud: "${prompt}"

Recuerda: Solo las líneas de canciones, sin numeración, sin explicaciones.`
        }
      ],
      temperature: 0.8,
      max_tokens: 800,
    });

    const text = completion.choices[0].message.content;
    console.log('📝 Respuesta de OpenAI:', text.substring(0, 200) + '...');

    const songs = parseSongLines(text);
    const unique = uniquePreserveOrder(songs);

    console.log(`✓ OpenAI generó ${unique.length} canciones válidas`);

    return unique.slice(0, numSongs);

  } catch (err) {
    console.error('❌ Error con OpenAI:', err.message);
    
    if (err.message.includes('401') || err.message.includes('Incorrect API key')) {
      console.error('⚠️  Tu OPENAI_API_KEY parece ser inválida');
      console.error('Verifica en: https://platform.openai.com/api-keys');
    }
    
    throw err;
  }
}

// Fallback inteligente por género
function getFallbackSongs(prompt, numSongs) {
  const lower = prompt.toLowerCase();
  
  const genres = {
    rock_clasico: [
      'Queen - Bohemian Rhapsody',
      'Led Zeppelin - Stairway to Heaven',
      'Pink Floyd - Comfortably Numb',
      'The Beatles - Let It Be',
      'The Rolling Stones - Sympathy for the Devil',
      'Deep Purple - Smoke on the Water',
      'Black Sabbath - Paranoid',
      'The Who - Won\'t Get Fooled Again',
      'Jimi Hendrix - Purple Haze',
      'The Doors - Light My Fire',
      'Cream - Sunshine of Your Love',
      'Lynyrd Skynyrd - Free Bird',
    ],
    rock_moderno: [
      'Foo Fighters - Everlong',
      'Red Hot Chili Peppers - Under the Bridge',
      'Nirvana - Smells Like Teen Spirit',
      'Pearl Jam - Alive',
      'Green Day - Boulevard of Broken Dreams',
      'Radiohead - Creep',
      'Muse - Uprising',
      'Linkin Park - In the End',
    ],
    pop: [
      'The Weeknd - Blinding Lights',
      'Dua Lipa - Levitating',
      'Bruno Mars - Uptown Funk',
      'Ed Sheeran - Shape of You',
      'Harry Styles - As It Was',
      'Taylor Swift - Shake It Off',
      'Ariana Grande - 7 Rings',
      'Post Malone - Circles',
      'Billie Eilish - Bad Guy',
      'Olivia Rodrigo - Good 4 U',
    ],
    latino: [
      'Bad Bunny - Titi Me Preguntó',
      'Shakira - Hips Don\'t Lie',
      'Karol G - TQG',
      'Los Bunkers - Venus',
      'Soda Stereo - De Música Ligera',
      'Mon Laferte - Tu Falta de Querer',
      'Daddy Yankee - Gasolina',
      'J Balvin - Mi Gente',
      'Rosalía - Malamente',
      'Peso Pluma - Ella Baila Sola',
    ],
    indie: [
      'Arctic Monkeys - Do I Wanna Know',
      'Tame Impala - The Less I Know The Better',
      'The Strokes - Last Nite',
      'MGMT - Electric Feel',
      'Phoenix - 1901',
      'Foster the People - Pumped Up Kicks',
      'Glass Animals - Heat Waves',
      'The Killers - Mr Brightside',
      'Cage the Elephant - Cigarette Daydreams',
      'Two Door Cinema Club - What You Know',
    ],
    chill: [
      'Billie Eilish - Ocean Eyes',
      'Lorde - Ribs',
      'The xx - Intro',
      'Cigarettes After Sex - Apocalypse',
      'Clairo - Sofia',
      'Rex Orange County - Loving Is Easy',
      'Beach House - Space Song',
      'Bon Iver - Holocene',
      'Hozier - Cherry Wine',
      'Daughter - Youth',
    ],
  };

  let selected = [];
  
  // Detectar género con palabras clave más específicas
  if (/(rock.*clasico|classic.*rock|70s.*rock|80s.*rock)/i.test(lower)) {
    selected = genres.rock_clasico;
  } else if (/(rock.*modern|modern.*rock|90s.*rock|2000s.*rock)/i.test(lower)) {
    selected = genres.rock_moderno;
  } else if (/(rock|metal|guitar|banda)/i.test(lower)) {
    selected = [...genres.rock_clasico, ...genres.rock_moderno];
  } else if (/(pop|comercial|radio|chart)/i.test(lower)) {
    selected = genres.pop;
  } else if (/(latin|español|spanish|reggaeton|chile|mexicano)/i.test(lower)) {
    selected = genres.latino;
  } else if (/(indie|alternativ|underground|hipster)/i.test(lower)) {
    selected = genres.indie;
  } else if (/(chill|relax|calm|suave|tranquil|study)/i.test(lower)) {
    selected = genres.chill;
  } else {
    // Mix de todos los géneros
    selected = Object.values(genres).flat();
  }

  // Mezclar y tomar las necesarias
  return selected.sort(() => Math.random() - 0.5).slice(0, numSongs);
}

// ==================================
//      TOKEN Y RATE LIMITING
// ==================================

const TOKEN_LIMIT = 50;
const TOKEN_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 horas
const usageDbPath = path.join(__dirname, 'token_usage.json');

async function readUsage() {
  try {
    const data = await fs.readFile(usageDbPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {}; // Si el archivo no existe, empezar con data vacía
    }
    throw err;
  }
}

async function writeUsage(data) {
  await fs.writeFile(usageDbPath, JSON.stringify(data, null, 2));
}

// =========================
//      MAIN ENDPOINT
// =========================

app.post('/api/playlist', async (req, res) => {
  const ip = req.ip;
  const numSongs = Number(req.body.numSongs) || 10;

  try {
    await lockfile.lock(usageDbPath);

    let usage;
    try {
      const data = await fs.readFile(usageDbPath, 'utf8');
      usage = JSON.parse(data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        usage = {};
      } else {
        throw err;
      }
    }

    const now = Date.now();
    let userData = usage[ip];

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
        const videoId = await findYoutubeVideoId(song);
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
    usage[ip] = userData;

    await writeUsage(usage);
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
  } finally {
    await lockfile.unlock(usageDbPath);
  }
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
      await openai.models.list();
      openaiStatus = 'working';
    } catch (err) {
      openaiStatus = err.message.includes('401') ? 'invalid_key' : 'error';
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

// ==================================
//      DATA CLEANUP
// ==================================

async function cleanupOldUsageData() {
  await lockfile.lock(usageDbPath);
  let usage;
  try {
    const data = await fs.readFile(usageDbPath, 'utf8');
    usage = JSON.parse(data);
  } catch (err) {
    await lockfile.unlock(usageDbPath);
    if (err.code === 'ENOENT') return; // No file to clean
    throw err;
  }

  const now = Date.now();
  let changed = false;
  for (const ip in usage) {
    if (now - usage[ip].firstRequest > TOKEN_WINDOW_MS) {
      delete usage[ip];
      changed = true;
    }
  }

  if (changed) {
    await fs.writeFile(usageDbPath, JSON.stringify(usage, null, 2));
  }
  await lockfile.unlock(usageDbPath);
}

// Run cleanup every 24 hours
setInterval(cleanupOldUsageData, TOKEN_WINDOW_MS);
