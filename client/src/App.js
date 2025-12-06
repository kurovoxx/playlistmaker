import React, { useState } from 'react';
import './App.css';

function App() {
  const [prompt, setPrompt] = useState('');
  const [numSongs, setNumSongs] = useState(10);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        throw new Error('Something went wrong');
      }

      const data = await response.json();
      setPlaylistUrl(data.playlistUrl);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>Music Playlist Generator</h1>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="prompt">Enter your music prompt:</label>
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