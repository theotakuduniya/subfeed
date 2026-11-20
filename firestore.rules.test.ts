/**
 * Security rules specification test suite for minisocial Firestore rules.
 * Verifies the "Dirty Dozen" payloads are denied and legitimate owner operations succeed.
 */
export interface RuleTestCase {
  name: string;
  actor: { uid: string; emailVerified: boolean } | null;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expected: 'ALLOW' | 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: RuleTestCase[] = [
  {
    name: '1. Unauthenticated read of user profile',
    actor: null,
    operation: 'get',
    path: '/users/alice',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '2. Cross-user PII read',
    actor: { uid: 'bob', emailVerified: true },
    operation: 'get',
    path: '/users/alice',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '3. Blanket list of /users collection',
    actor: { uid: 'alice', emailVerified: true },
    operation: 'list',
    path: '/users',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '4. Unverified email user write',
    actor: { uid: 'alice', emailVerified: false },
    operation: 'create',
    path: '/users/alice',
    payload: { uid: 'alice' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '5. Identity spoofing on user create',
    actor: { uid: 'alice', emailVerified: true },
    operation: 'create',
    path: '/users/alice',
    payload: { uid: 'bob' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '6. Shadow field injection (isAdmin)',
    actor: { uid: 'alice', emailVerified: true },
    operation: 'update',
    path: '/users/alice',
    payload: { isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '7. Client-forged timestamp on create',
    actor: { uid: 'alice', emailVerified: true },
    operation: 'create',
    path: '/users/alice',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '8. Mutating immutable createdAt on update',
    actor: { uid: 'alice', emailVerified: true },
    operation: 'update',
    path: '/users/alice',
    payload: { createdAt: 'request.time' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '9. Bounded array overflow (>100 subreddits)',
    actor: { uid: 'alice', emailVerified: true },
    operation: 'update',
    path: '/users/alice',
    payload: { subreddits: Array.from({ length: 101 }, (_, i) => `sub${i}`) },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '10. Poisoned document ID (>128 chars)',
    actor: { uid: 'alice', emailVerified: true },
    operation: 'create',
    path: `/users/alice/savedPosts/${'a'.repeat(160)}`,
    payload: { ownerId: 'alice', id: 'a'.repeat(160) },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '11. Orphaned saved post without parent /users/{uid}',
    actor: { uid: 'ghost', emailVerified: true },
    operation: 'create',
    path: '/users/ghost/savedPosts/post_1',
    payload: { ownerId: 'ghost', id: 'post_1' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '12. Value poisoning on enum field (theme)',
    actor: { uid: 'alice', emailVerified: true },
    operation: 'update',
    path: '/users/alice',
    payload: { theme: 'invalid_theme' },
    expected: 'PERMISSION_DENIED',
  },
];
