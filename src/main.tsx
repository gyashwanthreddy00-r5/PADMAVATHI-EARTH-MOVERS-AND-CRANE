import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target?.tagName === 'INPUT' && (target as HTMLInputElement).type === 'number') {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
    }
  }
});

document.addEventListener('wheel', (e) => {
  const target = e.target as HTMLElement;
  if (target?.tagName === 'INPUT' && (target as HTMLInputElement).type === 'number') {
    e.preventDefault();
  }
}, { passive: false });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
