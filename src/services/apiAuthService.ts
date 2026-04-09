import { IAuthService, User } from './types';

/**
 * API-based auth service that calls Vercel serverless functions instead of
 * Firebase client SDK. This allows the app to work behind the Great Firewall
 * since the client never contacts Google domains directly.
 */

const TOKEN_KEY = 'echomaster_id_token';
const REFRESH_TOKEN_KEY = 'echomaster_refresh_token';
const USER_KEY = 'echomaster_user';

// In-memory state
let currentUser: User | null = null;
let authStateListeners: Array<(user: User | null) => void> = [];
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function storeTokens(idToken: string, refreshToken: string, expiresIn?: string) {
  localStorage.setItem(TOKEN_KEY, idToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);

  // Schedule token refresh (Firebase tokens expire in 3600s / 1 hour)
  scheduleTokenRefresh(expiresIn ? parseInt(expiresIn) : 3600);
}

function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function storeUser(user: User | null) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_KEY);
  }
  currentUser = user;
}

function getStoredUser(): User | null {
  const stored = localStorage.getItem(USER_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
}

function notifyListeners(user: User | null) {
  authStateListeners.forEach(cb => cb(user));
}

function scheduleTokenRefresh(expiresInSeconds: number) {
  if (refreshTimer) clearTimeout(refreshTimer);
  // Refresh 5 minutes before expiry
  const refreshInMs = Math.max((expiresInSeconds - 300) * 1000, 60000);
  refreshTimer = setTimeout(async () => {
    await refreshTokens();
  }, refreshInMs);
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      // Refresh failed — user needs to re-login
      clearTokens();
      storeUser(null);
      notifyListeners(null);
      return false;
    }

    const data = await response.json();
    storeTokens(data.idToken, data.refreshToken, data.expiresIn);
    return true;
  } catch (error) {
    console.error('Token refresh failed:', error);
    return false;
  }
}

/**
 * Helper to make authenticated API calls. Automatically includes the auth token.
 */
export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response = await fetch(url, { ...options, headers });

  // If 401, try refreshing the token once
  if (response.status === 401 && getStoredRefreshToken()) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      const newToken = getStoredToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
      }
      response = await fetch(url, { ...options, headers });
    }
  }

  return response;
}

export const apiAuthService: IAuthService = {
  async loginWithEmail(email: string, password: string): Promise<void> {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.error || 'Login failed');
      // Map API error codes to Firebase-style error codes for compatibility
      if (data.code === 'INVALID_LOGIN_CREDENTIALS' || data.code === 'INVALID_PASSWORD' || data.code === 'EMAIL_NOT_FOUND') {
        (error as any).code = 'auth/invalid-credential';
      }
      throw error;
    }

    storeTokens(data.idToken, data.refreshToken, data.expiresIn);
    storeUser(data.user);
    notifyListeners(data.user);
  },

  async registerWithEmail(email: string, password: string, role: 'teacher' | 'student'): Promise<void> {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role }),
    });

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.error || 'Registration failed');
      if (data.code === 'EMAIL_EXISTS') {
        (error as any).code = 'auth/email-already-in-use';
      } else if (data.code?.startsWith('WEAK_PASSWORD')) {
        (error as any).code = 'auth/weak-password';
      }
      throw error;
    }

    storeTokens(data.idToken, data.refreshToken, data.expiresIn);
    storeUser(data.user);
    notifyListeners(data.user);
  },

  async logout(): Promise<void> {
    try {
      const token = getStoredToken();
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });
      }
    } catch (error) {
      console.error('Logout API call failed:', error);
    } finally {
      clearTokens();
      storeUser(null);
      notifyListeners(null);
    }
  },

  onAuthStateChanged(callback: (user: User | null) => void): () => void {
    authStateListeners.push(callback);

    // On first registration, check for existing session
    const token = getStoredToken();
    if (token) {
      // Validate the stored token with the server
      fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` },
      })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            storeUser(data.user);
            callback(data.user);
            // Schedule refresh for existing token
            scheduleTokenRefresh(3000); // Assume ~50min remaining for stored token
          } else {
            // Token invalid — try refresh
            const refreshed = await refreshTokens();
            if (refreshed) {
              const meRes = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${getStoredToken()}` },
              });
              if (meRes.ok) {
                const data = await meRes.json();
                storeUser(data.user);
                callback(data.user);
              } else {
                clearTokens();
                storeUser(null);
                callback(null);
              }
            } else {
              clearTokens();
              storeUser(null);
              callback(null);
            }
          }
        })
        .catch(() => {
          // Network error — use cached user if available
          const cached = getStoredUser();
          callback(cached);
        });
    } else {
      callback(null);
    }

    // Return unsubscribe function
    return () => {
      authStateListeners = authStateListeners.filter(cb => cb !== callback);
    };
  },

  getCurrentUser(): User | null {
    return currentUser || getStoredUser();
  },
};
