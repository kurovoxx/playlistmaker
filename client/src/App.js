import React, { useState, useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { fetchWithFallback } from './api';
import './App.css';

function App() {
  const [prompt, setPrompt] = useState('');
  const [numSongs, setNumSongs] = useState(10);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState({ count: 0, limit: 50 });

  const fetchUsage = async () => {
    try {
      // Add a cache-busting parameter to ensure we always get the latest count
      const response = await fetchWithFallback(`/api/usage?t=${new Date().getTime()}`);
      if (response.ok) {
        const data = await response.json();
        console.log('[Frontend] Received data from server:', data);
        setUsage(data);
      } else {
        console.error('[Frontend] Failed to fetch usage data, response not ok.', response);
      }
    } catch (err) {
      console.error('Error fetching usage:', err);
    }
  };

  useEffect(() => {
    // Removed fetchUsage() call as per user request.
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setPlaylistUrl('');

    try {
      const response = await fetchWithFallback(
        '/api/playlist',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prompt, numSongs }),
        }
      );

      if (!response.ok) {
        if (response.status === 429) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Song limit exceeded.');
        }
        throw new Error('An unexpected error occurred.');
      }

      if (!response.ok) {
        if (response.status === 429) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Song limit exceeded.');
        }
        throw new Error('An unexpected error occurred.');
      }

      const responseText = await response.text();
      console.log('[Frontend] Raw response from server:', responseText);
      const data = JSON.parse(responseText);
      
      setPlaylistUrl(data.playlistUrl);

      // Add logging for newUsageCount as requested
      console.log('[Frontend] Type of newUsageCount:', typeof data.newUsageCount);
      if (typeof data.newUsageCount === 'number') {
        console.log('[Frontend] New usage count received from playlist creation:', data.newUsageCount);
        setUsage(prevUsage => ({ ...prevUsage, count: data.newUsageCount }));
      } else {
        console.error('[Frontend] Error: newUsageCount is missing or not a number in the playlist creation response.');
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // 🔹 NUEVO: resetear la app al estado inicial
  const resetApp = () => {
    setPrompt('');
    setNumSongs(10);
    setPlaylistUrl('');
    setError('');
    setLoading(false);
  };

  return (
    <div className="app-wrapper">
      <div className="container">
        <h1 className="title">
          MusicBallade <p className="beta">beta</p>
        </h1>

        <p className="subtitle">
          Create AI-powered personalized playlists
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="prompt">Music Prompt</label>
            <div className="input-wrapper">
              <input
                type="text"
                id="prompt"
                placeholder="Describe your perfect playlist..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                required
              />
              <span className="input-icon">♪</span>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="num-songs">Number of Songs</label>
            <input
              type="number"
              id="num-songs"
              min="1"
              max="50"
              value={numSongs}
              onChange={(e) => setNumSongs(e.target.value)}
              required
            />
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Generating...' : 'Generate Playlist'}
          </button>
        </form>

        {error && <p className="error">{error}</p>}

        {playlistUrl && (
          <div className="playlist">
            <h2>Your playlist is ready!</h2>
            <a
              href={playlistUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={resetApp}
            >
              Open on YouTube
            </a>
          </div>
        )}

        <div className="usage-container">
          <p>
            <span>Songs generated</span>
            <span className="usage-badge">
              {usage.count} / {usage.limit}
            </span>
          </p>
          <div className="progress-bar-container">
            <div
              className="progress-bar"
              style={{
                width: `${(usage.count / usage.limit) * 100}%`,
              }}
            ></div>
          </div>
        </div>

        <div className="footer">
          <p>by • KuroVox</p>
          <p>complains & recomendations to • <a href='#'>musicballade.official@gmail.com</a></p>
          <p>
            <a href="#">Privacy Policy</a> •{' '}
            <a href="#">Terms of Service</a>
          </p>
        </div>
      </div>
      <Analytics />
    </div>
  );
}

export default App;
