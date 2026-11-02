import fs from "node:fs";
import path from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "sfras-1b538";
const email = process.env.FIREBASE_ADMIN_EMAIL || "ansariamaan8640@gmail.com";
const password = process.env.FIREBASE_ADMIN_PASSWORD || "Admin@12345";

// Find service account JSON file if available
function findServiceAccount() {
  const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const files = fs.readdirSync(scriptDir);
  const match = files.find((f) => f.endsWith(".json") && (f.includes("serviceAccount") || f.includes("adminsdk") || f.includes(projectId)));
  if (match) return path.join(scriptDir, match);

  return null;
}

const keyFile = findServiceAccount();
let credential;
if (keyFile) {
  try {
    const json = JSON.parse(fs.readFileSync(keyFile, "utf8"));
    credential = cert(json);
    console.log(`Using service account credential: ${path.basename(keyFile)}`);
  } catch (err) {
    console.error(`Failed to parse ${keyFile}:`, err.message);
  }
}

if (!keyFile) {
  console.error("\n❌ Firebase Admin Private Key (serviceAccountKey.json) zaroori hai!");
  console.error("Kyunki Firebase Admin SDK pure database aur authentication ka superuser hota hai,");
  console.error("Google sirf unhe allow karta hai jinke paas Service Account private key JSON file ho.\n");
  console.error("Ise download karne ka bilkul simple tareeqa:");
  console.error("1. Firebase Console open karein:");
  console.error(`   https://console.firebase.google.com/project/${projectId}/settings/serviceaccounts/adminsdk`);
  console.error("2. 'Generate new private key' button par click karein.");
  console.error("3. Download hui file ko yahan save ya paste kar dein:");
  console.error("   f:\\Projects\\SRAS\\backend\\firebase\\scripts\\serviceAccountKey.json");
  console.error("\nJaise hi aap file daal denge, ye script automatically execute ho jayega!\n");
  process.exit(1);
}

try {
  initializeApp({ credential, projectId });
} catch (initErr) {
  console.error("Firebase initializeApp error:", initErr.message);
  process.exit(1);
}

const auth = getAuth();
const firestore = getFirestore();

async function provisionUser(targetEmail) {
  let targetUser;
  try {
    targetUser = await auth.getUserByEmail(targetEmail);
    console.log(`User found in Firebase Authentication: ${targetUser.email} (UID: ${targetUser.uid})`);
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      console.log(`User ${targetEmail} does not exist in Firebase Auth. Creating user with temporary password...`);
      targetUser = await auth.createUser({
        email: targetEmail,
        password,
        displayName: targetEmail.split("@")[0],
      });
      console.log(`Created user ${targetEmail} (UID: ${targetUser.uid}) with password: ${password}`);
    } else {
      throw error;
    }
  }

  await auth.setCustomUserClaims(targetUser.uid, { ...targetUser.customClaims, admin: true });
  console.log(`Set admin custom claim for ${targetEmail}.`);

  await firestore.collection("profiles").doc(targetUser.uid).set({
    id: targetUser.uid,
    email: targetUser.email || targetEmail,
    display_name: targetUser.displayName || targetEmail.split("@")[0],
    role: "admin",
    updated_at: new Date().toISOString(),
  }, { merge: true });
  console.log(`Updated Firestore profile for UID: ${targetUser.uid} with role: admin.`);
  return targetUser;
}

// Provision primary email as well as all existing auth users
const targets = new Set([email, "ansariamaan8640@gmail.com", "aman@gmail.com"]);
try {
  const listUsersResult = await auth.listUsers(100);
  for (const u of listUsersResult.users) {
    if (u.email) targets.add(u.email);
  }
} catch (listErr) {
  console.log("Listing users:", listErr.message);
}

for (const targetEmail of targets) {
  await provisionUser(targetEmail);
}

const settingsRef = firestore.collection("factory_settings").doc("main");
const counterRef = firestore.collection("counters").doc("production_tasks");
await firestore.runTransaction(async (transaction) => {
  const [settingsSnapshot, counterSnapshot] = await Promise.all([
    transaction.get(settingsRef),
    transaction.get(counterRef),
  ]);
  if (!settingsSnapshot.exists) {
    transaction.create(settingsRef, {
      id: true,
      workspace_name: "Northstar Works",
      plant_location: "",
      time_zone: "UTC",
      max_employee_workload_percent: 85,
      prevent_overallocation: true,
      prioritize_skill_match: true,
      reserve_reorder_stock: true,
      conflict_notifications: true,
      low_stock_notifications: true,
      daily_shift_summary: false,
      shift_a_start: "06:00",
      shift_a_end: "14:00",
      shift_b_start: "14:00",
      shift_b_end: "22:00",
      updated_at: new Date().toISOString(),
    });
    console.log("Initialized factory_settings/main.");
  }
  if (!counterSnapshot.exists) {
    transaction.create(counterRef, { next: 1 });
    console.log("Initialized task counter.");
  }
});

console.log(`\n✅ SUCCESS: Factory administrator access successfully granted to all authorized accounts!`);
console.log("Aap ab in accounts se login kar sakte hain.");

