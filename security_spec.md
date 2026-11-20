# Security Specification — minisocial Firestore Rules

## 1. Data Invariants

1. **Strict Ownership & PII Isolation**: `/users/{userId}` contains user email and personal reading state. Only the authenticated, email-verified user whose `request.auth.uid == userId` may `get`, `create`, `update`, or `delete` their own document. Listing `/users` is unconditionally denied (`allow list: if false;`).
2. **Master Gate Relational Integrity**: A document in `/users/{userId}/savedPosts/{postId}` can only be created or updated if the parent `/users/{userId}` document exists and belongs to the caller (`request.auth.uid == userId`).
3. **Immutable Identity & Timestamps**: `uid` and `createdAt` on `/users/{userId}`, and `ownerId`, `id`, and `savedAt` on `/users/{userId}/savedPosts/{postId}`, can never be mutated after creation. All server timestamps must match `request.time`.
4. **Strict Payload Boundaries**: Every string and array enforces explicit `.size()` caps (`subreddits <= 100`, `xAccounts <= 100`, `readPostIds <= 250`, `galleryImages <= 20`), strict `hasAll`/`hasOnly` key allowlists, and `isValidId()` regex guards (`^[a-zA-Z0-9_\-]+$`) on document IDs.
5. **Query Enforcer**: `allow list` on `/users/{userId}/savedPosts/{postId}` validates `isOwner(userId)` and `resource.data.ownerId == request.auth.uid` without any `get()` or `exists()` reads.

## 2. The "Dirty Dozen" Adversarial Payloads

| # | Attack Vector | Target Path | Expected Result |
| --- | --- | --- | --- |
| 1 | Unauthenticated read of user profile | `GET /users/alice` | `PERMISSION_DENIED` |
| 2 | Cross-user PII read (`bob` reading `alice`) | `GET /users/alice` | `PERMISSION_DENIED` |
| 3 | Blanket list / scraping of `/users` | `LIST /users` | `PERMISSION_DENIED` |
| 4 | Unverified email write (`email_verified: false`) | `CREATE /users/alice` | `PERMISSION_DENIED` |
| 5 | Identity spoofing (`uid: "bob"` under `/users/alice`) | `CREATE /users/alice` | `PERMISSION_DENIED` |
| 6 | Shadow field injection (`isAdmin: true`) | `UPDATE /users/alice` | `PERMISSION_DENIED` |
| 7 | Client-forged `createdAt` / `updatedAt` timestamp | `CREATE /users/alice` | `PERMISSION_DENIED` |
| 8 | Mutating immutable `createdAt` or `uid` | `UPDATE /users/alice` | `PERMISSION_DENIED` |
| 9 | Array overflow (`subreddits` with 101 items) | `UPDATE /users/alice` | `PERMISSION_DENIED` |
| 10 | Invalid / poisoned document ID (`../etc/passwd` or 200-char ID) | `CREATE /users/alice/savedPosts/{badId}` | `PERMISSION_DENIED` |
| 11 | Orphaned saved post without parent `/users/{uid}` | `CREATE /users/ghost/savedPosts/p1` | `PERMISSION_DENIED` |
| 12 | Value poisoning (`theme: "hax"` or `title` > 600 chars) | `UPDATE /users/alice` / `CREATE /users/alice/savedPosts/p1` | `PERMISSION_DENIED` |
