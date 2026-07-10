import type { User } from '@supabase/supabase-js';
import { displayName, onAuthChange, signIn, signOut, signUp, translateAuthError } from '../net/auth.js';
import { cloudEnabled } from '../net/supabase.js';

/** Listeners that want to react to login/logout (gallery, save list, editor). */
const listeners: ((user: User | null) => void)[] = [];
let current: User | null = null;

export const authUser = (): User | null => current;

export function onUserChange(cb: (user: User | null) => void): void {
  listeners.push(cb);
  cb(current);
}

/**
 * Wires the auth box on the start panel and the login/register dialog.
 * Without a configured Supabase project everything stays hidden and the
 * game remains a pure guest build.
 */
export function initAuthUi(): void {
  if (!cloudEnabled()) return;

  const box = document.getElementById('auth-box')!;
  const stateLabel = document.getElementById('auth-state')!;
  const openBtn = document.getElementById('auth-open') as HTMLButtonElement;
  const logoutBtn = document.getElementById('auth-logout') as HTMLButtonElement;
  const dialog = document.getElementById('auth-dialog')!;
  const email = document.getElementById('auth-email') as HTMLInputElement;
  const password = document.getElementById('auth-password') as HTMLInputElement;
  const usernameRow = document.getElementById('auth-username-row')!;
  const username = document.getElementById('auth-username') as HTMLInputElement;
  const error = document.getElementById('auth-error')!;
  const submit = document.getElementById('auth-submit') as HTMLButtonElement;

  box.style.display = 'flex';
  let mode: 'login' | 'register' = 'login';

  const setMode = (m: 'login' | 'register'): void => {
    mode = m;
    usernameRow.style.display = m === 'register' ? '' : 'none';
    submit.textContent = m === 'register' ? 'Konto erstellen' : 'Anmelden';
    password.autocomplete = m === 'register' ? 'new-password' : 'current-password';
    error.textContent = '';
    for (const btn of dialog.querySelectorAll<HTMLButtonElement>('[data-authtab]')) {
      btn.classList.toggle('active', btn.dataset['authtab'] === m);
    }
  };
  for (const btn of dialog.querySelectorAll<HTMLButtonElement>('[data-authtab]')) {
    btn.addEventListener('click', () => setMode(btn.dataset['authtab'] as 'login' | 'register'));
  }

  openBtn.addEventListener('click', () => {
    dialog.style.display = 'flex';
    setMode('login');
    email.focus();
  });
  document.getElementById('auth-cancel')!.addEventListener('click', () => {
    dialog.style.display = 'none';
  });
  logoutBtn.addEventListener('click', () => void signOut());

  submit.addEventListener('click', () => {
    void (async () => {
      error.textContent = '';
      submit.disabled = true;
      try {
        if (mode === 'register') await signUp(email.value.trim(), password.value, username.value);
        else await signIn(email.value.trim(), password.value);
        dialog.style.display = 'none';
        password.value = '';
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : translateAuthError(err);
      } finally {
        submit.disabled = false;
      }
    })();
  });
  password.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit.click();
  });

  onAuthChange((user) => {
    current = user;
    if (user) {
      stateLabel.innerHTML = `Angemeldet als <span class="username"></span>`;
      stateLabel.querySelector('.username')!.textContent = displayName(user);
      openBtn.style.display = 'none';
      logoutBtn.style.display = '';
    } else {
      stateLabel.textContent = 'Nicht angemeldet';
      openBtn.style.display = '';
      logoutBtn.style.display = 'none';
    }
    for (const cb of listeners) cb(user);
  });
}
