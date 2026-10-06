import React from 'react';
import { createRoot } from 'react-dom/client';
import './ui/lcars/styles/index.css';
import { App } from './App';
import { LcarsProvider } from './ui/lcars/LcarsProvider';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LcarsProvider>
      <App />
    </LcarsProvider>
  </React.StrictMode>,
);
