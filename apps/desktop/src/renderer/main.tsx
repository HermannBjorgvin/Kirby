import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { initTheme } from './lib/theme.js';
import './styles.css';
import '@wterm/react/css';

// Apply the persisted theme class before the first paint.
initTheme();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
