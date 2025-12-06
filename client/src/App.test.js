import { render, screen } from '@testing-library/react';
import App from './App';

test('renders music playlist generator title', () => {
  render(<App />);
  const titleElement = screen.getByText(/Music Playlist Generator/i);
  expect(titleElement).toBeInTheDocument();
});