const { google } = require('googleapis');
const OpenAI = require('openai');

// OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// YouTube API
let youtube;

function initializeYoutube(auth) {
  youtube = google.youtube({
    version: 'v3',
    auth,
  });
}

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
async function findYoutubeVideoId(q, retries = 0, markKeyAsExhausted, getNextYouTubeKey, currentKeyIndex, YOUTUBE_API_KEYS) {
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
                    return await findYoutubeVideoId(q, retries + 1, markKeyAsExhausted, getNextYouTubeKey, currentKeyIndex, YOUTUBE_API_KEYS);
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
                    return await findYoutubeVideoId(q, retries + 1, markKeyAsExhausted, getNextYouTubeKey, currentKeyIndex, YOUTUBE_API_KEYS);
                }
            }

            // Otros errores: loguear y continuar con siguiente query del mismo key
            console.warn(`⚠️  Error buscando "${query}":`, msg);
        }

    }
    return null;
}

const { GPT_PROMPT } = require('./gpt_prompt');

// Generar canciones con OpenAI
async function generateWithOpenAI(prompt, numSongs) {
  try {
    console.log('🤖 Generando canciones con OpenAI GPT-3.5...');

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: GPT_PROMPT,
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

module.exports = {
  initializeYoutube,
  findYoutubeVideoId,
  generateWithOpenAI,
  getFallbackSongs,
  parseSongLines,
  uniquePreserveOrder,
};
