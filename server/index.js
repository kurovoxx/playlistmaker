const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const port = 5000;

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY,
});

app.use(cors());
app.use(express.json());

app.post('/api/playlist', async (req, res) => {
  const { prompt, numSongs } = req.body;

  const options = {
    method: 'POST',
    url: 'https://api.edenai.run/v2/text/generation',
    headers: {
      authorization: `Bearer ${process.env.EDENAI_API_KEY}`,
    },
    data: {
      providers: 'openai',
      text: `Generate a list of ${numSongs} songs based on the following prompt: "${prompt}". Return only the song titles, separated by newlines.`,
      temperature: 0.2,
      max_tokens: 250,
    },
  };

  try {
    const response = await axios.request(options);
    const generatedText = response.data.openai.generated_text;
    const songTitles = generatedText.split('\n').filter(title => title.trim() !== '');

    const videoIds = [];
    for (const title of songTitles) {
      try {
        const searchResponse = await youtube.search.list({
          part: 'snippet',
          q: title,
          type: 'video',
          maxResults: 1,
        });
        if (searchResponse.data.items.length > 0) {
          videoIds.push(searchResponse.data.items[0].id.videoId);
        }
      } catch (error) {
        console.error(`Error searching for song "${title}":`, error);
      }
    }

    if (videoIds.length > 0) {
      const playlistUrl = `https://www.youtube.com/watch_videos?video_ids=${videoIds.join(',')}`;
      res.json({ playlistUrl });
    } else {
      res.status(404).json({ error: 'No videos found for the generated songs.' });
    }
  } catch (error) {
    console.error('Error details:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to generate playlist' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});