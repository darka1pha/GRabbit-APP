import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { GrabPillWindow } from './components/GrabPillWindow';
import './styles.css';

const isPill = window.location.hash.includes('pill');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPill ? <GrabPillWindow /> : <App />}
  </StrictMode>
);
