export type SortOption = 'best' | 'hot' | 'new' | 'top' | 'rising' | 'controversial';

export type TimeframeOption = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';

export type CommentSortOption = 'best' | 'top' | 'new' | 'controversial';

export type FeedDensity = 'comfortable' | 'compact' | 'card';

export type ThemeOption = 'dark' | 'light' | 'mocha' | 'glass';

export type FontOption =
  | 'geist-mono'
  | 'geist'
  | 'inter'
  | 'jakarta'
  | 'space-grotesk'
  | 'jetbrains-mono';

export type PostSource = 'reddit' | 'x';

export type SourceFilter = 'all' | 'reddit' | 'x';

export type ActiveView =
  | { type: 'all' }
  | { type: 'subreddit'; name: string }
  | { type: 'x'; handle: string }
  | { type: 'topic'; topic: string }
  | { type: 'saved' };

export interface QuotedPost {
  author: string;
  authorName?: string;
  text: string;
  url: string;
}

export interface RedditPost {
  id: string;
  fullname: string;
  source?: PostSource;
  title: string;
  subreddit: string;
  author: string;
  authorName?: string;
  score: number;
  upvoteRatio: number | null;
  numComments: number;
  reposts?: number;
  views?: number;
  createdUtc: number;
  permalink: string;
  url: string;
  domain: string;
  isSelf: boolean;
  selftext: string;
  flair: string | null;
  thumbnail: string | null;
  previewImage: string | null;
  galleryImages: string[];
  isVideo: boolean;
  videoUrl: string | null;
  over18: boolean;
  spoiler: boolean;
  stickied: boolean;
  isRetweet?: boolean;
  retweetedBy?: string | null;
  quotedPost?: QuotedPost | null;
}

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
  isSubmitter: boolean;
  distinguished: string | null;
  depth: number;
  replies: RedditComment[];
}

export interface SubredditSuggestion {
  name: string;
  title: string;
  subscribers: number;
  description: string;
}

export interface XProfilePreview {
  handle: string;
  name: string;
  followers: number;
  description: string;
  avatarUrl: string | null;
  verified: boolean;
}

export interface SubredditItem {
  name: string;
  addedAt: number;
}

export type NitterInstanceStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface NitterInstanceHealth {
  url: string;
  host: string;
  status: NitterInstanceStatus;
  latencyMs: number | null;
  rssOk: boolean;
  searchOk: boolean;
  lastCheckedAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
  isActive: boolean;
}

export interface NitterInstancesResponse {
  activeInstance: string;
  previousInstance?: string;
  instances: NitterInstanceHealth[];
  lastCheckedAt: number | null;
}

export interface FeedResponse {
  posts: RedditPost[];
  after: string | null;
  source?: string;
  instance?: string | null;
}
