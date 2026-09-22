import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';
import './styles/themes.css';

// HashRouter plutôt que BrowserRouter : l'application doit pouvoir être
// ouverte depuis un fichier local ou un sous-dossier sans configuration
// de serveur, et fonctionner hors ligne dans tous les cas.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
