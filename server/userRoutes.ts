import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { getPrisma, isDatabaseConfigured } from './prisma.ts';

const SESSION_COOKIE_NAME = 'minisocial_session';
const OAUTH_STATE_COOKIE_NAME = 'minisocial_oauth_state';
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

const VALID_THEMES = new Set(['dark', 'light', 'mocha', 'glass']);
const VALID_FONTS = new Set([
  'geist-mono',
  'geist',
  'inter',
  'jakarta',
  'space-grotesk',
  'jetbrains-mono',
]);
const VALID_DENSITIES = new Set(['comfortable', 'compact', 'card']);
const VALID_SORTS = new Set(['best', 'hot', 'new', 'top', 'rising', 'controversial']);
const VALID_TIMEFRAMES = new Set(['hour', 'day', 'week', 'month', 'year', 'all']);
const VALID_SOURCES = new Set(['all', 'reddit', 'x']);

function getSessionSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.DATABASE_URL ||
    'minisocial-dev-fallback-secret'
  );
}

function getBaseUrl(): string {
  const raw =
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://localhost:${process.env.PORT || 3000}`;
  return raw.replace(/\/+$/, '');
}

function isSecureCookieContext(): boolean {
  const baseUrl = getBaseUrl();
  return baseUrl.startsWith('https://') || process.env.NODE_ENV === 'production';
}

function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    (process.env.GOOGLE_CLIENT_ID || '').trim() &&
      (process.env.GOOGLE_CLIENT_SECRET || '').trim()
  );
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

function appendSetCookie(res: Response, cookieStr: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [cookieStr]);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieStr]);
  } else {
    res.setHeader('Set-Cookie', [String(existing), cookieStr]);
  }
}

function buildCookieHeader(
  name: string,
  value: string,
  maxAgeSec: number
): string {
  const secure = isSecureCookieContext();
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSec}`,
    secure ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

function signSessionToken(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp })).toString(
    'base64url'
  );
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return null;

  const expected = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (
      typeof parsed?.uid === 'string' &&
      typeof parsed?.exp === 'number' &&
      parsed.exp > Math.floor(Date.now() / 1000)
    ) {
      return parsed.uid;
    }
  } catch {
    return null;
  }
  return null;
}

function sanitizeStringArray(input: unknown, maxLen: number): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const clean = item.trim().slice(0, 100);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= maxLen) break;
  }
  return out;
}

function sanitizeIdArray(input: unknown, maxLen: number): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const clean = item.trim().slice(0, 128);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= maxLen) break;
  }
  return out;
}

function popupResponseHtml(message: { type: string; error?: string }): string {
  const serialized = JSON.stringify(message).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>minisocial Sign-In</title>
  </head>
  <body style="font-family: system-ui, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0;">
    <p style="font-size: 14px; opacity: 0.85;">Completing sign-in...</p>
    <script>
      (function () {
        var payload = ${serialized};
        if (window.opener) {
          window.opener.postMessage(payload, '*');
          window.close();
        } else {
          window.location.href = '/';
        }
      })();
    </script>
  </body>
</html>`;
}

async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  const cookies = parseCookies(req);
  return verifySessionToken(cookies[SESSION_COOKIE_NAME]);
}

async function loadFullUserState(userId: string) {
  const prisma = getPrisma();
  if (!prisma) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      subreddits: { orderBy: { position: 'asc' } },
      xAccounts: { orderBy: { position: 'asc' } },
      xTopics: { orderBy: { position: 'asc' } },
      savedPosts: { orderBy: { savedAt: 'desc' }, take: 200 },
      readPosts: { orderBy: { readAt: 'desc' }, take: 250 },
    },
  });

  if (!user) return null;

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoUrl,
    },
    initialized: user.initialized,
    subreddits: user.subreddits.map((s) => s.name),
    xAccounts: user.xAccounts.map((x) => x.handle),
    xTopics: user.xTopics.map((t) => t.topic),
    savedPosts: user.savedPosts.map((s) => s.payload),
    readPostIds: user.readPosts.map((r) => r.postId),
    preferences: {
      theme: VALID_THEMES.has(user.theme) ? user.theme : 'dark',
      font: VALID_FONTS.has(user.font) ? user.font : 'geist-mono',
      density: VALID_DENSITIES.has(user.density) ? user.density : 'comfortable',
      sort: VALID_SORTS.has(user.sort) ? user.sort : 'best',
      timeframe: VALID_TIMEFRAMES.has(user.timeframe) ? user.timeframe : 'day',
      sourceFilter: VALID_SOURCES.has(user.sourceFilter) ? user.sourceFilter : 'all',
    },
  };
}

export function registerUserRoutes(app: Express): void {
  // GET /api/auth/status
  app.get('/api/auth/status', async (req, res) => {
    const dbConfigured = isDatabaseConfigured();
    const oauthConfigured = isGoogleOAuthConfigured();

    if (!dbConfigured) {
      return res.json({ dbConfigured: false, oauthConfigured, user: null });
    }

    try {
      const userId = await getAuthenticatedUserId(req);
      if (!userId) {
        return res.json({ dbConfigured: true, oauthConfigured, user: null });
      }
      const prisma = getPrisma();
      const user = await prisma?.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, displayName: true, photoUrl: true },
      });

      if (!user) {
        appendSetCookie(res, buildCookieHeader(SESSION_COOKIE_NAME, '', 0));
        return res.json({ dbConfigured: true, oauthConfigured, user: null });
      }

      return res.json({
        dbConfigured: true,
        oauthConfigured,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoUrl,
        },
      });
    } catch (err) {
      console.error('Auth status error:', err);
      return res.json({ dbConfigured, oauthConfigured, user: null });
    }
  });

  // GET /api/auth/google/url
  app.get('/api/auth/google/url', (_req, res) => {
    if (!isDatabaseConfigured()) {
      return res.status(503).json({
        error:
          'PostgreSQL database is not configured yet. Add DATABASE_URL in your Render environment variables.',
      });
    }
    if (!isGoogleOAuthConfigured()) {
      return res.status(503).json({
        error:
          'Google OAuth is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment variables.',
      });
    }

    const state = crypto.randomBytes(24).toString('hex');
    appendSetCookie(res, buildCookieHeader(OAUTH_STATE_COOKIE_NAME, state, 600));

    const redirectUri = `${getBaseUrl()}/api/auth/google/callback`;
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      access_type: 'online',
    });

    return res.json({
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    });
  });

  // GET /api/auth/google/callback (handle with and without trailing slash)
  app.get(
    ['/api/auth/google/callback', '/api/auth/google/callback/'],
    async (req, res) => {
      const code = String(req.query.code || '').trim();
      const state = String(req.query.state || '').trim();
      const oauthError = String(req.query.error || '').trim();

      if (oauthError) {
        return res
          .status(400)
          .send(
            popupResponseHtml({
              type: 'OAUTH_AUTH_ERROR',
              error: oauthError === 'access_denied' ? 'Sign-in was cancelled.' : oauthError,
            })
          );
      }

      const cookies = parseCookies(req);
      const expectedState = cookies[OAUTH_STATE_COOKIE_NAME];
      appendSetCookie(res, buildCookieHeader(OAUTH_STATE_COOKIE_NAME, '', 0));

      if (!code || !state || !expectedState || state !== expectedState) {
        return res
          .status(400)
          .send(
            popupResponseHtml({
              type: 'OAUTH_AUTH_ERROR',
              error: 'Invalid or expired OAuth state. Please try signing in again.',
            })
          );
      }

      const prisma = getPrisma();
      if (!prisma || !isGoogleOAuthConfigured()) {
        return res
          .status(503)
          .send(
            popupResponseHtml({
              type: 'OAUTH_AUTH_ERROR',
              error: 'Server database or Google OAuth is not configured.',
            })
          );
      }

      try {
        const redirectUri = `${getBaseUrl()}/api/auth/google/callback`;
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
            client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });

        if (!tokenRes.ok) {
          const text = await tokenRes.text();
          console.error('Google token exchange failed:', tokenRes.status, text);
          return res
            .status(502)
            .send(
              popupResponseHtml({
                type: 'OAUTH_AUTH_ERROR',
                error: 'Google sign-in token exchange failed. Verify your redirect URI and credentials.',
              })
            );
        }

        const tokenData = (await tokenRes.json()) as { access_token?: string };
        if (!tokenData.access_token) {
          throw new Error('Missing access token from Google.');
        }

        const profileRes = await fetch(
          'https://www.googleapis.com/oauth2/v3/userinfo',
          {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          }
        );

        if (!profileRes.ok) {
          throw new Error('Unable to fetch Google user profile.');
        }

        const profile = (await profileRes.json()) as {
          sub?: string;
          email?: string;
          name?: string;
          picture?: string;
        };

        if (!profile.sub || !profile.email) {
          throw new Error('Google profile is missing required email or sub.');
        }

        const user = await prisma.user.upsert({
          where: { googleId: profile.sub },
          update: {
            email: profile.email,
            displayName: (profile.name || '').slice(0, 120),
            photoUrl: (profile.picture || '').slice(0, 512),
          },
          create: {
            googleId: profile.sub,
            email: profile.email,
            displayName: (profile.name || '').slice(0, 120),
            photoUrl: (profile.picture || '').slice(0, 512),
          },
        });

        const sessionToken = signSessionToken(user.id);
        appendSetCookie(
          res,
          buildCookieHeader(SESSION_COOKIE_NAME, sessionToken, SESSION_TTL_SEC)
        );

        return res.send(popupResponseHtml({ type: 'OAUTH_AUTH_SUCCESS' }));
      } catch (err) {
        console.error('Google OAuth callback error:', err);
        return res
          .status(500)
          .send(
            popupResponseHtml({
              type: 'OAUTH_AUTH_ERROR',
              error:
                err instanceof Error
                  ? err.message
                  : 'Unable to complete Google sign-in.',
            })
          );
      }
    }
  );

  // POST /api/auth/logout
  app.post('/api/auth/logout', (_req, res) => {
    appendSetCookie(res, buildCookieHeader(SESSION_COOKIE_NAME, '', 0));
    return res.json({ ok: true });
  });

  // GET /api/user/state
  app.get('/api/user/state', async (req, res) => {
    const prisma = getPrisma();
    if (!prisma) {
      return res.status(503).json({ error: 'Database not configured.' });
    }
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    try {
      const state = await loadFullUserState(userId);
      if (!state) {
        return res.status(404).json({ error: 'User not found.' });
      }
      return res.json(state);
    } catch (err) {
      console.error('Load user state error:', err);
      return res.status(500).json({ error: 'Failed to load user state.' });
    }
  });

  // POST /api/user/bootstrap — merges local guest state on first login & returns cloud state
  app.post('/api/user/bootstrap', async (req, res) => {
    const prisma = getPrisma();
    if (!prisma) {
      return res.status(503).json({ error: 'Database not configured.' });
    }
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    try {
      const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, initialized: true },
      });

      if (!existing) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const body = req.body || {};
      const localSubreddits = sanitizeStringArray(body.subreddits, 100);
      const localXAccounts = sanitizeStringArray(body.xAccounts, 100);
      const localXTopics = sanitizeStringArray(body.xTopics, 100);
      const localReadIds = sanitizeIdArray(body.readPostIds, 250);
      const localSavedPosts = Array.isArray(body.savedPosts)
        ? body.savedPosts.slice(0, 100)
        : [];
      const prefs = body.preferences || {};

      if (!existing.initialized) {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: userId },
            data: {
              initialized: true,
              theme: VALID_THEMES.has(prefs.theme) ? prefs.theme : 'dark',
              font: VALID_FONTS.has(prefs.font) ? prefs.font : 'geist-mono',
              density: VALID_DENSITIES.has(prefs.density) ? prefs.density : 'comfortable',
              sort: VALID_SORTS.has(prefs.sort) ? prefs.sort : 'best',
              timeframe: VALID_TIMEFRAMES.has(prefs.timeframe) ? prefs.timeframe : 'day',
              sourceFilter: VALID_SOURCES.has(prefs.sourceFilter)
                ? prefs.sourceFilter
                : 'all',
            },
          });

          if (localSubreddits.length > 0) {
            await tx.followedSubreddit.createMany({
              data: localSubreddits.map((name, position) => ({
                userId,
                name,
                position,
              })),
              skipDuplicates: true,
            });
          }

          if (localXAccounts.length > 0) {
            await tx.followedXAccount.createMany({
              data: localXAccounts.map((handle, position) => ({
                userId,
                handle,
                position,
              })),
              skipDuplicates: true,
            });
          }

          if (localXTopics.length > 0) {
            await tx.followedTopic.createMany({
              data: localXTopics.map((topic, position) => ({
                userId,
                topic,
                position,
              })),
              skipDuplicates: true,
            });
          }

          for (const post of localSavedPosts) {
            if (!post || typeof post.id !== 'string' || !post.id.trim()) continue;
            await tx.savedPost.upsert({
              where: { userId_postId: { userId, postId: post.id.slice(0, 128) } },
              update: {},
              create: {
                userId,
                postId: post.id.slice(0, 128),
                source: post.source === 'x' ? 'x' : 'reddit',
                payload: post,
              },
            });
          }

          if (localReadIds.length > 0) {
            await tx.readPost.createMany({
              data: localReadIds.map((postId) => ({ userId, postId })),
              skipDuplicates: true,
            });
          }
        });
      } else if (localReadIds.length > 0) {
        // Merge any newly read posts from before sign-in
        await prisma.readPost.createMany({
          data: localReadIds.map((postId) => ({ userId, postId })),
          skipDuplicates: true,
        });
      }

      const fullState = await loadFullUserState(userId);
      return res.json(fullState);
    } catch (err) {
      console.error('Bootstrap user state error:', err);
      return res.status(500).json({ error: 'Failed to sync account state.' });
    }
  });

  // PUT /api/user/feeds — save followed subreddits & X accounts
  app.put('/api/user/feeds', async (req, res) => {
    const prisma = getPrisma();
    if (!prisma) {
      return res.status(503).json({ error: 'Database not configured.' });
    }
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const subreddits = sanitizeStringArray(req.body?.subreddits, 100);
    const xAccounts = sanitizeStringArray(req.body?.xAccounts, 100);
    const xTopics = sanitizeStringArray(req.body?.xTopics, 100);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.followedSubreddit.deleteMany({ where: { userId } });
        if (subreddits.length > 0) {
          await tx.followedSubreddit.createMany({
            data: subreddits.map((name, position) => ({ userId, name, position })),
            skipDuplicates: true,
          });
        }

        await tx.followedXAccount.deleteMany({ where: { userId } });
        if (xAccounts.length > 0) {
          await tx.followedXAccount.createMany({
            data: xAccounts.map((handle, position) => ({ userId, handle, position })),
            skipDuplicates: true,
          });
        }

        await tx.followedTopic.deleteMany({ where: { userId } });
        if (xTopics.length > 0) {
          await tx.followedTopic.createMany({
            data: xTopics.map((topic, position) => ({ userId, topic, position })),
            skipDuplicates: true,
          });
        }
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('Sync feeds error:', err);
      return res.status(500).json({ error: 'Failed to save followed feeds.' });
    }
  });

  // PUT /api/user/preferences
  app.put('/api/user/preferences', async (req, res) => {
    const prisma = getPrisma();
    if (!prisma) {
      return res.status(503).json({ error: 'Database not configured.' });
    }
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const body = req.body || {};
    const data: Record<string, string> = {};
    if (VALID_THEMES.has(body.theme)) data.theme = body.theme;
    if (VALID_FONTS.has(body.font)) data.font = body.font;
    if (VALID_DENSITIES.has(body.density)) data.density = body.density;
    if (VALID_SORTS.has(body.sort)) data.sort = body.sort;
    if (VALID_TIMEFRAMES.has(body.timeframe)) data.timeframe = body.timeframe;
    if (VALID_SOURCES.has(body.sourceFilter)) data.sourceFilter = body.sourceFilter;

    if (Object.keys(data).length === 0) {
      return res.json({ ok: true });
    }

    try {
      await prisma.user.update({ where: { id: userId }, data });
      return res.json({ ok: true });
    } catch (err) {
      console.error('Save preferences error:', err);
      return res.status(500).json({ error: 'Failed to save preferences.' });
    }
  });

  // POST /api/user/saved — save or update a bookmarked post
  app.post('/api/user/saved', async (req, res) => {
    const prisma = getPrisma();
    if (!prisma) {
      return res.status(503).json({ error: 'Database not configured.' });
    }
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const post = req.body?.post;
    if (!post || typeof post.id !== 'string' || !post.id.trim()) {
      return res.status(400).json({ error: 'Valid post payload is required.' });
    }

    const postId = post.id.trim().slice(0, 128);
    try {
      await prisma.savedPost.upsert({
        where: { userId_postId: { userId, postId } },
        update: { payload: post, savedAt: new Date() },
        create: {
          userId,
          postId,
          source: post.source === 'x' ? 'x' : 'reddit',
          payload: post,
        },
      });
      return res.json({ ok: true });
    } catch (err) {
      console.error('Save post error:', err);
      return res.status(500).json({ error: 'Failed to save post.' });
    }
  });

  // DELETE /api/user/saved/:postId
  app.delete('/api/user/saved/:postId', async (req, res) => {
    const prisma = getPrisma();
    if (!prisma) {
      return res.status(503).json({ error: 'Database not configured.' });
    }
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const postId = String(req.params.postId || '').trim().slice(0, 128);
    if (!postId) {
      return res.status(400).json({ error: 'Missing postId.' });
    }

    try {
      await prisma.savedPost.deleteMany({ where: { userId, postId } });
      return res.json({ ok: true });
    } catch (err) {
      console.error('Delete saved post error:', err);
      return res.status(500).json({ error: 'Failed to remove saved post.' });
    }
  });

  // DELETE /api/user/saved
  app.delete('/api/user/saved', async (req, res) => {
    const prisma = getPrisma();
    if (!prisma) {
      return res.status(503).json({ error: 'Database not configured.' });
    }
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    try {
      await prisma.savedPost.deleteMany({ where: { userId } });
      return res.json({ ok: true });
    } catch (err) {
      console.error('Clear saved posts error:', err);
      return res.status(500).json({ error: 'Failed to clear saved posts.' });
    }
  });

  // POST /api/user/read
  app.post('/api/user/read', async (req, res) => {
    const prisma = getPrisma();
    if (!prisma) {
      return res.status(503).json({ error: 'Database not configured.' });
    }
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const postId = String(req.body?.postId || '').trim().slice(0, 128);
    if (!postId) {
      return res.status(400).json({ error: 'Missing postId.' });
    }

    try {
      await prisma.readPost.upsert({
        where: { userId_postId: { userId, postId } },
        update: { readAt: new Date() },
        create: { userId, postId },
      });

      // Keep at most 250 recent read records per user
      const stale = await prisma.readPost.findMany({
        where: { userId },
        orderBy: { readAt: 'desc' },
        skip: 250,
        select: { id: true },
      });
      if (stale.length > 0) {
        await prisma.readPost.deleteMany({
          where: { id: { in: stale.map((r) => r.id) } },
        });
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error('Mark post read error:', err);
      return res.status(500).json({ error: 'Failed to mark post as read.' });
    }
  });

  // DELETE /api/user/read
  app.delete('/api/user/read', async (req, res) => {
    const prisma = getPrisma();
    if (!prisma) {
      return res.status(503).json({ error: 'Database not configured.' });
    }
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    try {
      await prisma.readPost.deleteMany({ where: { userId } });
      return res.json({ ok: true });
    } catch (err) {
      console.error('Clear read history error:', err);
      return res.status(500).json({ error: 'Failed to clear read history.' });
    }
  });
}
