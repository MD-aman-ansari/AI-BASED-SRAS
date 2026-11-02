# Backend

The backend is built entirely on Firebase Authentication, Cloud Firestore, and callable Cloud Functions (v2).

- [`firebase/firestore.rules`](./firebase/firestore.rules) — Firestore security rules enforcing administrator read access and disallowing direct client writes.
- [`firebase/functions/`](./firebase/functions/) — Transactional callable server functions for resource allocation, inventory tracking, and scheduling.
- [`firebase/scripts/`](./firebase/scripts/) — Administrative utilities, including initial admin setup (`set-admin.mjs`).

See the [Firebase setup guide](../frontend/public/FIREBASE_SETUP.md) for configuration and deployment instructions.
