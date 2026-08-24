import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('#root is missing from index.html');

createRoot(root).render(
  /*
    No `AuthProvider` here (D-071).

    It wrapped every route, so the merchant page — which has no account and never will —
    constructed the analyst's Supabase client on load. That was the last source of Chrome's
    *"Multiple GoTrueClient instances detected"*, and an expected warning is one nobody notices
    changing.

    `App` routes first and the analyst branch provides its own auth, so the decision about which
    application this is stays in one place.
  */
  <StrictMode>
    <App />
  </StrictMode>,
);
