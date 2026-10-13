import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/ui';
import { SessionProvider } from './lib/session';
import './styles.css';

// Hash routing works on GitHub Pages without server-side rewrites.
const router = createHashRouter([
  {
    path: '*',
    element: (
      <ToastProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </ToastProvider>
    ),
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
