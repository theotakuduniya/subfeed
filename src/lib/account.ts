import type {
  FeedDensity,
  FontOption,
  RedditPost,
  SortOption,
  SourceFilter,
  ThemeOption,
  TimeframeOption,
} from '../types/reddit';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  photoURL: string;
}

export interface AuthStatusResponse {
  dbConfigured: boolean;
  oauthConfigured: boolean;
  user: AuthUser | null;
}

export interface UserPreferencesPayload {
  theme: ThemeOption;
  font: FontOption;
  density: FeedDensity;
  sort: SortOption;
  timeframe: TimeframeOption;
  sourceFilter: SourceFilter;
}

export interface CloudAccountState {
  user: AuthUser;
  initialized: boolean;
  subreddits: string[];
  xAccounts: string[];
  xTopics: string[];
  savedPosts: RedditPost[];
  readPostIds: string[];
  preferences: UserPreferencesPayload;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.error === 'string' && body.error) {
        message = body.error;
      }
    } catch {
      // Ignore parse error
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  try {
    return await apiFetch<AuthStatusResponse>('/api/auth/status');
  } catch {
    return { dbConfigured: false, oauthConfigured: false, user: null };
  }
}

export async function startGoogleSignInPopup(): Promise<AuthUser> {
  const { url } = await apiFetch<{ url: string }>('/api/auth/google/url');

  return new Promise<AuthUser>((resolve, reject) => {
    const width = 520;
    const height = 640;
    const left = Math.max(0, Math.round((window.screen.width - width) / 2));
    const top = Math.max(0, Math.round((window.screen.height - height) / 2));

    const popup = window.open(
      url,
      'minisocial_google_oauth',
      `width=${width},height=${height},left=${left},top=${top},popup=yes`
    );

    if (!popup) {
      reject(
        new Error('Popup was blocked by your browser. Please allow popups and try again.')
      );
      return;
    }

    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(pollTimer);
    };

    const onMessage = async (event: MessageEvent) => {
      if (settled) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'OAUTH_AUTH_SUCCESS') {
        settled = true;
        cleanup();
        try {
          const status = await fetchAuthStatus();
          if (status.user) {
            resolve(status.user);
          } else {
            reject(
              new Error('Sign-in completed, but session cookie could not be verified.')
            );
          }
        } catch (err) {
          reject(err);
        }
      } else if (data.type === 'OAUTH_AUTH_ERROR') {
        settled = true;
        cleanup();
        reject(new Error(typeof data.error === 'string' ? data.error : 'Google sign-in failed.'));
      }
    };

    const pollTimer = window.setInterval(() => {
      if (settled) return;
      if (popup.closed) {
        settled = true;
        cleanup();
        reject(new Error('POPUP_CLOSED'));
      }
    }, 450);

    window.addEventListener('message', onMessage);
  });
}

export async function logoutAccount(): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
}

export async function bootstrapUserState(payload: {
  subreddits: string[];
  xAccounts: string[];
  xTopics: string[];
  savedPosts: RedditPost[];
  readPostIds: string[];
  preferences: UserPreferencesPayload;
}): Promise<CloudAccountState> {
  return apiFetch<CloudAccountState>('/api/user/bootstrap', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function syncUserFeedsToServer(payload: {
  subreddits: string[];
  xAccounts: string[];
  xTopics: string[];
}): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/user/feeds', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function syncUserPreferencesToServer(
  preferences: UserPreferencesPayload
): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/user/preferences', {
    method: 'PUT',
    body: JSON.stringify(preferences),
  });
}

export async function savePostToServer(post: RedditPost): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/user/saved', {
    method: 'POST',
    body: JSON.stringify({ post }),
  });
}

export async function deleteSavedPostFromServer(postId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(
    `/api/user/saved/${encodeURIComponent(postId)}`,
    { method: 'DELETE' }
  );
}

export async function clearAllSavedPostsFromServer(): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/user/saved', { method: 'DELETE' });
}

export async function markPostReadOnServer(postId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/user/read', {
    method: 'POST',
    body: JSON.stringify({ postId }),
  });
}

export async function clearReadHistoryOnServer(): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/user/read', { method: 'DELETE' });
}
