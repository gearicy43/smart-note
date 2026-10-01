import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './ui/AppContext';
import { createWebServices } from './platform/web';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider services={createWebServices()}>
      <App />
    </AppProvider>
  </React.StrictMode>,
);
