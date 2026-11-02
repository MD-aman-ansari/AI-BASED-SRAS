# Firebase Setup and Deployment Guide

Forge uses Firebase Authentication, Cloud Firestore, callable Cloud Functions (v2), and Firebase Hosting.
The browser uses only the client-side Firebase web-app configuration. Administrative access and operational integrity are enforced by Firebase Authentication custom claims, Firestore Security Rules, and transactional Cloud Functions.

## 1. Configure Firebase Project

1. Create a Firebase project in the [Firebase Console](https://console.firebase.google.com/) and register a Web App.
2. Under **Authentication → Sign-in method**, enable **Email/Password**.
3. Create a **Cloud Firestore** database (in production mode).
4. Cloud Functions deployment requires the Firebase **Blaze** (pay-as-you-go) billing plan.
5. Copy `frontend/.env.example` to `frontend/.env` and fill in your Firebase Web App configuration:

   ```env
   VITE_FIREBASE_API_KEY="your-api-key"
   VITE_FIREBASE_AUTH_DOMAIN="your-project.firebaseapp.com"
   VITE_FIREBASE_PROJECT_ID="your-project-id"
   VITE_FIREBASE_APP_ID="your-app-id"
   VITE_FIREBASE_STORAGE_BUCKET="your-project.firebasestorage.app"
   VITE_FIREBASE_MESSAGING_SENDER_ID="your-sender-id"
   VITE_FIREBASE_FUNCTIONS_REGION="us-central1"
   ```

6. Under **Authentication → Settings → Authorized domains**, ensure your local (`localhost`) and production hosting domains are listed.

7. Install the Firebase CLI and login:

   ```powershell
   npm install --global firebase-tools
   firebase login
   firebase use --add
   ```

## 2. Set Up the First Factory Administrator

1. Create a user account in **Authentication → Users** (or through the app login/register screen).
2. Grant the administrator custom claim and initialize the factory settings document using the setup script:

   ```powershell
   cd backend/firebase/scripts
   $env:FIREBASE_PROJECT_ID = "YOUR_FIREBASE_PROJECT_ID"
   $env:FIREBASE_ADMIN_EMAIL = "admin@company.com"
   npm install
   npm run set-admin
   ```

   This script:
   - Sets the `admin: true` custom claim in Firebase Authentication.
   - Creates the administrator's document in the `profiles` collection with `role: "admin"`.
   - Initializes the default `factory_settings/main` document and production task counters.

3. Sign out and sign back in to the web app to refresh the authentication token with the new `admin` claim.

## 3. Seed College Demo Dataset (Optional)

You can seed standard manufacturing resources (4 technicians, 4 machines, 5 materials, and active production runs) using either:

- **Option A (In-App UI):** Go to **Settings** in the web app and click **"Seed College Demo Data"**.
- **Option B (CLI Script):**
  ```powershell
  cd backend/firebase/scripts
  npm run seed-demo
  ```

## 4. Local Development

Run the frontend locally with Vite:

```powershell
cd frontend
npm install
npm run dev
```

Open the printed localhost URL in your browser.

## 5. Deploy to Firebase

To deploy Security Rules, Cloud Functions, and the Frontend Hosting bundle:

```powershell
# 1. Install Cloud Functions dependencies
cd backend/firebase/functions
npm install
cd ../../..

# 2. Build the frontend
npm --prefix frontend run build

# 3. Deploy all services to Firebase
firebase deploy
```

## Security & Architecture Overview

- **Firestore Security Rules**: Direct client writes are restricted to verified administrators (`isAdmin()`). Non-admin users cannot self-assign or escalate their role to `admin` in `/profiles/{userId}`.
- **Dual-Mode Execution**: Transactions execute via Cloud Functions (v2) on Blaze plan, with a safe client-side Firestore `runTransaction` fallback for local development or Firebase Spark (free tier) plans.
- **Smart Allocation**: Enforces strict operator skill verification, machine type compatibility, material safety buffers, and temporal zero-overlap scheduling.
