import React, { useState, useEffect } from 'react';
import './App.css';

// Use environment variable for the API URL, with a fallback for local development
const API_URL = process.env.REACT_APP_API_URL || '';

function App() {
  const [prompt, setPrompt] = useState('');
  const [numSongs, setNumSongs] = useState(10);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState({ count: 0, limit: 50 });

  const fetchUsage = async () => {
    try {
      // Prepend the API_URL to the request path
      const response = await fetch(`${API_URL}/api/usage`);
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
      // Prepend the API_URL to the request path
      const response = await fetch(`${API_URL}/api/playlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, numSongs }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Límite de canciones excedido.');
        }
        throw new Error('Ocurrió un error inesperado.');
      }

      const data = await response.json();
      setPlaylistUrl(data.playlistUrl);
      fetchUsage(); // Actualizar el uso
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>Music Playlist Generator</h1>

      <div className="usage-container">
        <p>Canciones generadas: {usage.count} / {usage.limit}</p>
        <div className="progress-bar-container">
          <div
            className="progress-bar"
            style={{ width: `${(usage.count / usage.limit) * 100}%` }}
          ></div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="prompt">Ingresa tu prompt musical:</label>
          <input
            type="text"
            id="prompt"
            name="prompt"
            placeholder="e.g., Chilean rock without Los Prisioneros"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="num-songs">Number of songs:</label>
          <input
            type="number"
            id="num-songs"
            name="num-songs"
            min="1"
            value={numSongs}
            onChange={(e) => setNumSongs(e.target.value)}
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
            Open Playlist
          </a>
        </div>
      )}
    </div>
  );
}

export default App;
