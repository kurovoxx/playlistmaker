import React, { useState } from 'react';
import './App.css';

function App() {
  const [prompt, setPrompt] = useState('');
  const [numSongs, setNumSongs] = useState(10);

  const handleSubmit = (event) => {
    event.preventDefault();
    console.log('Prompt:', prompt);
    console.log('Number of songs:', numSongs);
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
        <button type="submit">Generate Playlist</button>
      </form>
    </div>
  );
}

export default App;