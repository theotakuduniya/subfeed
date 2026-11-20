import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  FeedDensity,
  FontOption,
  RedditPost,
  SortOption,
  SourceFilter,
  ThemeOption,
  TimeframeOption,
} from '../types/reddit';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export interface LocalFeedPreferences {
  subreddits: string[];
  xAccounts: string[];
  readPostIds: string[];
  theme: ThemeOption;
  font: FontOption;
  density: FeedDensity;
  sort: SortOption;
  timeframe: TimeframeOption;
  sourceFilter: SourceFilter;
}

export interface CloudUserFeedState extends LocalFeedPreferences {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

const VALID_THEMES = new Set<ThemeOption>(['dark', 'light', 'mocha', 'glass']);
const VALID_FONTS = new Set<FontOption>([
  'geist-mono',
  'geist',
  'inter',
  'jakarta',
  'space-grotesk',
  'jetbrains-mono',
]);
const VALID_DENSITIES = new Set<FeedDensity>(['comfortable', 'compact', 'card']);
const VALID_SORTS = new Set<SortOption>([
  'best',
  'hot',
  'new',
  'top',
  'rising',
  'controversial',
]);
const VALID_TIMEFRAMES = new Set<TimeframeOption>([
  'hour',
  'day',
  'week',
  'month',
  'year',
  'all',
]);
const VALID_SOURCES = new Set<SourceFilter>(['all', 'reddit', 'x']);

export function sanitizeFirestoreId(rawId: string): string {
  const cleaned = String(rawId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return cleaned.length > 0 ? cleaned : `post_${Date.now()}`;
}

function clampString(val: unknown, maxLen: number, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  return val.slice(0, maxLen);
}

function sanitizeStringList(items: unknown, maxLen: number): string[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, 128);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= maxLen) break;
  }
  return out;
}

function sanitizePreferences(state: LocalFeedPreferences): LocalFeedPreferences {
  return {
    subreddits: sanitizeStringList(state.subreddits, 100),
    xAccounts: sanitizeStringList(state.xAccounts, 100),
    readPostIds: sanitizeStringList(state.readPostIds, 250),
    theme: VALID_THEMES.has(state.theme) ? state.theme : 'dark',
    font: VALID_FONTS.has(state.font) ? state.font : 'geist-mono',
    density: VALID_DENSITIES.has(state.density) ? state.density : 'comfortable',
    sort: VALID_SORTS.has(state.sort) ? state.sort : 'best',
    timeframe: VALID_TIMEFRAMES.has(state.timeframe) ? state.timeframe : 'day',
    sourceFilter: VALID_SOURCES.has(state.sourceFilter) ? state.sourceFilter : 'all',
  };
}

function buildSavedPostDoc(uid: string, post: RedditPost) {
  const docId = sanitizeFirestoreId(post.id);
  const title = clampString(post.title, 600).trim() || '(Untitled post)';
  const galleryImages = sanitizeStringList(post.galleryImages, 20).map((url) =>
    url.slice(0, 1000)
  );

  const payload: Record<string, unknown> = {
    ownerId: uid,
    id: docId,
    fullname: clampString(post.fullname || docId, 128),
    source: post.source === 'x' ? 'x' : 'reddit',
    title,
    subreddit: clampString(post.subreddit, 120),
    author: clampString(post.author, 120),
    score: Number.isFinite(post.score) ? post.score : 0,
    upvoteRatio:
      typeof post.upvoteRatio === 'number' && Number.isFinite(post.upvoteRatio)
        ? post.upvoteRatio
        : null,
    numComments: Number.isFinite(post.numComments) ? post.numComments : 0,
    createdUtc: Number.isFinite(post.createdUtc)
      ? post.createdUtc
      : Math.floor(Date.now() / 1000),
    permalink: clampString(post.permalink, 500),
    url: clampString(post.url, 1000),
    domain: clampString(post.domain, 200),
    isSelf: Boolean(post.isSelf),
    selftext: clampString(post.selftext, 8000),
    flair: post.flair ? clampString(post.flair, 160) : null,
    thumbnail: post.thumbnail ? clampString(post.thumbnail, 1000) : null,
    previewImage: post.previewImage ? clampString(post.previewImage, 1000) : null,
    galleryImages,
    isVideo: Boolean(post.isVideo),
    videoUrl: post.videoUrl ? clampString(post.videoUrl, 1000) : null,
    over18: Boolean(post.over18),
    spoiler: Boolean(post.spoiler),
    stickied: Boolean(post.stickied),
    savedAt: serverTimestamp(),
  };

  if (typeof post.authorName === 'string' && post.authorName.trim()) {
    payload.authorName = clampString(post.authorName, 160);
  }
  if (typeof post.reposts === 'number' && Number.isFinite(post.reposts)) {
    payload.reposts = post.reposts;
  }
  if (typeof post.views === 'number' && Number.isFinite(post.views)) {
    payload.views = post.views;
  }

  return { docId, payload };
}

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

/**
 * Ensures the signed-in user's /users/{uid} document exists before any subcollection writes.
 * On first sign-in, seeds cloud state with the user's current local feeds, read history, and saved posts.
 */
export async function ensureUserCloudProfile(
  user: User,
  localState: LocalFeedPreferences,
  localSavedPosts: RedditPost[]
): Promise<CloudUserFeedState | null> {
  const uid = user.uid;
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);
  const safeLocal = sanitizePreferences(localState);

  try {
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      const initialDoc = {
        uid,
        displayName: clampString(user.displayName, 120),
        email: clampString(user.email, 254),
        photoURL: clampString(user.photoURL, 512),
        ...safeLocal,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(userRef, initialDoc);

      // Migrate any locally bookmarked posts into /users/{uid}/savedPosts
      if (localSavedPosts.length > 0) {
        for (const post of localSavedPosts.slice(0, 50)) {
          await savePostToCloud(uid, post);
        }
      }

      return {
        uid,
        displayName: initialDoc.displayName,
        email: initialDoc.email,
        photoURL: initialDoc.photoURL,
        ...safeLocal,
      };
    }

    const data = snap.data();
    const existingReadIds = sanitizeStringList(data.readPostIds, 250);
    const mergedReadIds = sanitizeStringList(
      [...safeLocal.readPostIds, ...existingReadIds],
      250
    );

    const nextDisplayName = clampString(user.displayName ?? data.displayName, 120);
    const nextEmail = clampString(user.email ?? data.email, 254);
    const nextPhotoURL = clampString(user.photoURL ?? data.photoURL, 512);

    const needsProfileSync =
      nextDisplayName !== (data.displayName ?? '') ||
      nextEmail !== (data.email ?? '') ||
      nextPhotoURL !== (data.photoURL ?? '') ||
      mergedReadIds.length !== existingReadIds.length;

    if (needsProfileSync) {
      await updateDoc(userRef, {
        displayName: nextDisplayName,
        email: nextEmail,
        photoURL: nextPhotoURL,
        readPostIds: mergedReadIds,
        updatedAt: serverTimestamp(),
      });
    }

    return {
      uid,
      displayName: nextDisplayName,
      email: nextEmail,
      photoURL: nextPhotoURL,
      subreddits: sanitizeStringList(data.subreddits, 100),
      xAccounts: sanitizeStringList(data.xAccounts, 100),
      readPostIds: mergedReadIds,
      theme: VALID_THEMES.has(data.theme) ? data.theme : safeLocal.theme,
      font: VALID_FONTS.has(data.font) ? data.font : safeLocal.font,
      density: VALID_DENSITIES.has(data.density) ? data.density : safeLocal.density,
      sort: VALID_SORTS.has(data.sort) ? data.sort : safeLocal.sort,
      timeframe: VALID_TIMEFRAMES.has(data.timeframe)
        ? data.timeframe
        : safeLocal.timeframe,
      sourceFilter: VALID_SOURCES.has(data.sourceFilter)
        ? data.sourceFilter
        : safeLocal.sourceFilter,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function syncFeedsAndReadHistory(
  uid: string,
  payload: {
    subreddits: string[];
    xAccounts: string[];
    readPostIds: string[];
  }
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      subreddits: sanitizeStringList(payload.subreddits, 100),
      xAccounts: sanitizeStringList(payload.xAccounts, 100),
      readPostIds: sanitizeStringList(payload.readPostIds, 250),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function syncUserPreferences(
  uid: string,
  prefs: {
    theme: ThemeOption;
    font: FontOption;
    density: FeedDensity;
    sort: SortOption;
    timeframe: TimeframeOption;
    sourceFilter: SourceFilter;
  }
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      theme: VALID_THEMES.has(prefs.theme) ? prefs.theme : 'dark',
      font: VALID_FONTS.has(prefs.font) ? prefs.font : 'geist-mono',
      density: VALID_DENSITIES.has(prefs.density) ? prefs.density : 'comfortable',
      sort: VALID_SORTS.has(prefs.sort) ? prefs.sort : 'best',
      timeframe: VALID_TIMEFRAMES.has(prefs.timeframe) ? prefs.timeframe : 'day',
      sourceFilter: VALID_SOURCES.has(prefs.sourceFilter) ? prefs.sourceFilter : 'all',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeUserFeedState(
  uid: string,
  onData: (state: CloudUserFeedState) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      onData({
        uid,
        displayName: clampString(data.displayName, 120),
        email: clampString(data.email, 254),
        photoURL: clampString(data.photoURL, 512),
        subreddits: sanitizeStringList(data.subreddits, 100),
        xAccounts: sanitizeStringList(data.xAccounts, 100),
        readPostIds: sanitizeStringList(data.readPostIds, 250),
        theme: VALID_THEMES.has(data.theme) ? data.theme : 'dark',
        font: VALID_FONTS.has(data.font) ? data.font : 'geist-mono',
        density: VALID_DENSITIES.has(data.density) ? data.density : 'comfortable',
        sort: VALID_SORTS.has(data.sort) ? data.sort : 'best',
        timeframe: VALID_TIMEFRAMES.has(data.timeframe) ? data.timeframe : 'day',
        sourceFilter: VALID_SOURCES.has(data.sourceFilter) ? data.sourceFilter : 'all',
      });
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch {
        // Error already logged cleanly
      }
    }
  );
}

export function subscribeSavedPosts(
  uid: string,
  onData: (posts: RedditPost[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `users/${uid}/savedPosts`;
  const savedQuery = query(
    collection(db, 'users', uid, 'savedPosts'),
    where('ownerId', '==', uid)
  );

  return onSnapshot(
    savedQuery,
    (snapshot) => {
      const rows: { post: RedditPost; savedAtMs: number }[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const savedAtTs = d.savedAt as Timestamp | undefined;
        const savedAtMs =
          savedAtTs && typeof savedAtTs.toMillis === 'function'
            ? savedAtTs.toMillis()
            : Date.now();

        rows.push({
          savedAtMs,
          post: {
            id: typeof d.id === 'string' ? d.id : docSnap.id,
            fullname: typeof d.fullname === 'string' ? d.fullname : docSnap.id,
            source: d.source === 'x' ? 'x' : 'reddit',
            title: typeof d.title === 'string' ? d.title : '',
            subreddit: typeof d.subreddit === 'string' ? d.subreddit : '',
            author: typeof d.author === 'string' ? d.author : '',
            authorName: typeof d.authorName === 'string' ? d.authorName : undefined,
            score: typeof d.score === 'number' ? d.score : 0,
            upvoteRatio: typeof d.upvoteRatio === 'number' ? d.upvoteRatio : null,
            numComments: typeof d.numComments === 'number' ? d.numComments : 0,
            reposts: typeof d.reposts === 'number' ? d.reposts : undefined,
            views: typeof d.views === 'number' ? d.views : undefined,
            createdUtc: typeof d.createdUtc === 'number' ? d.createdUtc : 0,
            permalink: typeof d.permalink === 'string' ? d.permalink : '',
            url: typeof d.url === 'string' ? d.url : '',
            domain: typeof d.domain === 'string' ? d.domain : '',
            isSelf: Boolean(d.isSelf),
            selftext: typeof d.selftext === 'string' ? d.selftext : '',
            flair: typeof d.flair === 'string' ? d.flair : null,
            thumbnail: typeof d.thumbnail === 'string' ? d.thumbnail : null,
            previewImage: typeof d.previewImage === 'string' ? d.previewImage : null,
            galleryImages: Array.isArray(d.galleryImages) ? d.galleryImages : [],
            isVideo: Boolean(d.isVideo),
            videoUrl: typeof d.videoUrl === 'string' ? d.videoUrl : null,
            over18: Boolean(d.over18),
            spoiler: Boolean(d.spoiler),
            stickied: Boolean(d.stickied),
          },
        });
      });

      rows.sort((a, b) => b.savedAtMs - a.savedAtMs);
      onData(rows.map((r) => r.post));
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Error already logged cleanly
      }
    }
  );
}

export async function savePostToCloud(uid: string, post: RedditPost): Promise<void> {
  const { docId, payload } = buildSavedPostDoc(uid, post);
  const path = `users/${uid}/savedPosts/${docId}`;
  const ref = doc(db, 'users', uid, 'savedPosts', docId);

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        score: payload.score,
        numComments: payload.numComments,
        title: payload.title,
        selftext: payload.selftext,
        ...(typeof payload.reposts === 'number' ? { reposts: payload.reposts } : {}),
        ...(typeof payload.views === 'number' ? { views: payload.views } : {}),
      });
    } else {
      await setDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteSavedPostFromCloud(
  uid: string,
  postId: string
): Promise<void> {
  const docId = sanitizeFirestoreId(postId);
  const path = `users/${uid}/savedPosts/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'savedPosts', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearAllSavedPostsFromCloud(
  uid: string,
  posts: RedditPost[]
): Promise<void> {
  if (posts.length === 0) return;
  const path = `users/${uid}/savedPosts`;
  try {
    const batch = writeBatch(db);
    for (const post of posts) {
      const docId = sanitizeFirestoreId(post.id);
      batch.delete(doc(db, 'users', uid, 'savedPosts', docId));
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
