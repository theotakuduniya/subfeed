import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Bookmark,
  Check,
  Cloud,
  EyeOff,
  Loader2,
  LogOut,
  X,
} from 'lucide-react';

interface ProfileModalProps {
  isOpen: boolean;
  user: User | null;
  authLoading: boolean;
  syncing: boolean;
  subredditCount: number;
  xAccountCount: number;
  savedCount: number;
  readCount: number;
  onSignInGoogle: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onClearReadHistory: () => void;
  onClose: () => void;
}

function GoogleMark() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}

export function ProfileModal({
  isOpen,
  user,
  authLoading,
  syncing,
  subredditCount,
  xAccountCount,
  savedCount,
  readCount,
  onSignInGoogle,
  onSignOut,
  onClearReadHistory,
  onClose,
}: ProfileModalProps) {
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  if (!isOpen) return null;

  const initials = (user?.displayName || user?.email || 'M')
    .trim()
    .slice(0, 1)
    .toUpperCase();

  const handleGoogleAuth = async () => {
    setAuthError(null);
    setBusy(true);
    try {
      await onSignInGoogle();
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAuthError(null);
      } else if (code === 'auth/popup-blocked') {
        setAuthError('Popup was blocked by your browser. Please allow popups and try again.');
      } else {
        setAuthError(
          err instanceof Error ? err.message : 'Unable to sign in with Google right now.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setAuthError(null);
    setBusy(true);
    try {
      await onSignOut();
      onClose();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to sign out.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Profile"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 dark:bg-black/65 glass:bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Surface */}
      <div className="relative z-10 w-full max-w-[420px] max-h-[90dvh] flex flex-col bg-[var(--sf-modal)] border border-[var(--sf-border)] rounded-xl shadow-2xl overflow-hidden glass:backdrop-blur-2xl glass:shadow-[0_24px_80px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.16)]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--sf-border)] flex items-center justify-between gap-4 shrink-0">
          <h2 className="text-[14px] font-semibold text-[var(--sf-text)]">
            Profile
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="p-1.5 -mr-1 text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-hover)] rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {authLoading ? (
            <div className="py-10 flex items-center justify-center gap-2 text-[12.5px] text-[var(--sf-text-muted)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Checking account...</span>
            </div>
          ) : user ? (
            <>
              {/* Signed-In User Identity */}
              <div className="flex items-center gap-3.5">
                {user.photoURL && !avatarFailed ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'Profile avatar'}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarFailed(true)}
                    className="w-11 h-11 rounded-full object-cover border border-[var(--sf-border)] shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-[var(--sf-active)] border border-[var(--sf-border)] flex items-center justify-center text-[15px] font-semibold text-[var(--sf-text)] shrink-0">
                    {initials}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-[var(--sf-text)] truncate">
                    {user.displayName || 'minisocial reader'}
                  </div>
                  <div className="text-[12px] text-[var(--sf-text-muted)] truncate">
                    {user.email}
                  </div>
                  <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-[var(--sf-text-muted)]">
                    {syncing ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-[var(--sf-accent)]" />
                        <span>Syncing cloud feed...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3 h-3 text-emerald-500" />
                        <span>Cloud sync active</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Account Stats Grid */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface)]">
                  <div className="text-[11px] text-[var(--sf-text-muted)]">Subreddits</div>
                  <div className="mt-1 text-[16px] font-semibold tabular-nums text-[var(--sf-text)]">
                    {subredditCount}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface)]">
                  <div className="text-[11px] text-[var(--sf-text-muted)]">X Accounts</div>
                  <div className="mt-1 text-[16px] font-semibold tabular-nums text-[var(--sf-text)]">
                    {xAccountCount}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface)]">
                  <div className="text-[11px] text-[var(--sf-text-muted)] flex items-center gap-1">
                    <Bookmark className="w-3 h-3" />
                    <span>Saved posts</span>
                  </div>
                  <div className="mt-1 text-[16px] font-semibold tabular-nums text-[var(--sf-text)]">
                    {savedCount}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface)]">
                  <div className="text-[11px] text-[var(--sf-text-muted)] flex items-center gap-1">
                    <EyeOff className="w-3 h-3" />
                    <span>Marked read</span>
                  </div>
                  <div className="mt-1 text-[16px] font-semibold tabular-nums text-[var(--sf-text)]">
                    {readCount}
                  </div>
                </div>
              </div>

              {authError && (
                <p className="text-[12px] text-red-500 leading-relaxed">{authError}</p>
              )}

              {/* Actions */}
              <div className="pt-2 border-t border-[var(--sf-border-subtle)] flex flex-wrap items-center justify-between gap-2">
                {readCount > 0 ? (
                  <button
                    type="button"
                    onClick={onClearReadHistory}
                    className="px-3 py-1.5 text-[12px] text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] bg-[var(--sf-surface)] border border-[var(--sf-border)] hover:border-[var(--sf-border-strong)] rounded-md transition-colors whitespace-nowrap"
                  >
                    Reset read posts
                  </button>
                ) : (
                  <span className="text-[11.5px] text-[var(--sf-text-muted)]">
                    No read history yet
                  </span>
                )}

                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-red-600 dark:text-red-400 mocha:text-[#f38ba8] bg-[var(--sf-surface)] border border-[var(--sf-border)] hover:border-red-400 dark:hover:border-red-500/60 mocha:hover:border-[#f38ba8]/60 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {busy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <LogOut className="w-3.5 h-3.5" />
                  )}
                  <span>Sign out</span>
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Signed-Out Welcome & Value Prop */}
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 text-[12px] font-medium text-[var(--sf-accent)]">
                  <Cloud className="w-3.5 h-3.5" />
                  <span>Sync across devices</span>
                </div>
                <h3 className="text-[15px] font-semibold text-[var(--sf-text)]">
                  Sign in to minisocial
                </h3>
                <p className="text-[12.5px] leading-relaxed text-[var(--sf-text-muted)]">
                  Keep your followed subreddits, X accounts, saved posts, read history, and display settings backed up to your account.
                </p>
              </div>

              <button
                type="button"
                onClick={handleGoogleAuth}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 text-[13px] font-medium rounded-lg border border-[var(--sf-border-strong)] bg-[var(--sf-surface)] hover:bg-[var(--sf-hover)] text-[var(--sf-text)] transition-colors disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <GoogleMark />
                )}
                <span>{busy ? 'Connecting with Google...' : 'Continue with Google'}</span>
              </button>

              {authError && (
                <p className="text-[12px] text-red-500 leading-relaxed">{authError}</p>
              )}

              {/* Guest local read-history utility */}
              <div className="pt-3 border-t border-[var(--sf-border-subtle)] flex items-center justify-between gap-2 text-[11.5px] text-[var(--sf-text-muted)]">
                <span>
                  {subredditCount + xAccountCount} feeds · {savedCount} saved · {readCount} read locally
                </span>
                {readCount > 0 && (
                  <button
                    type="button"
                    onClick={onClearReadHistory}
                    className="text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] underline underline-offset-4 shrink-0"
                  >
                    Reset read
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
