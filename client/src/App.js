import React, { useState, useEffect } from 'react';
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
      const response = await fetch('http://localhost:5000/api/usage');
      if (response.ok) {
        const data = await response.json();
        setUsage(data);
      }
    } catch (err) {
      console.error('Error fetching usage:', err);
    }
  };

  useEffect(() => {
    fetchUsage();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setPlaylistUrl('');

    try {
      const response = await fetch('http://localhost:5000/api/playlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, numSongs }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Song limit exceeded.');
        }
        throw new Error('An unexpected error occurred.');
      }

      const data = await response.json();
      setPlaylistUrl(data.playlistUrl);
      fetchUsage();
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-wrapper">
      <div className="container">
        <h1 className='title'> MelodyFlow <p className='beta'>beta</p></h1>
     
        <p className="subtitle">Create AI-powered personalized playlists</p>

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
            <a href={playlistUrl} target="_blank" rel="noopener noreferrer">
              Open on YouTube
            </a>
          </div>
        )}

        <div className="usage-container">
          <p>
            <span>Songs generated</span>
            <span className="usage-badge">{usage.count} / {usage.limit}</span>
          </p>
          <div className="progress-bar-container">
            <div
              className="progress-bar"
              style={{ width: `${(usage.count / usage.limit) * 100}%` }}
            ></div>
          </div>
        </div>

        <div className="footer">
          <p>by • KuroVox</p>
          <p>
            <a href="#">Privacy Policy</a> • <a href="#">Terms of Service</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;