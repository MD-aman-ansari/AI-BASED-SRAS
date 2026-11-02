import fs from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const key = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
initializeApp({ credential: cert(key), projectId: "sfras-1b538" });

const auth = getAuth();
const db = getFirestore();

console.log("Checking Firestore collections...");
const collections = ["profiles", "employees", "machines", "materials", "production_tasks", "factory_settings"];
for (const col of collections) {
  const snap = await db.collection(col).get();
  console.log(`Collection "${col}": ${snap.size} documents.`);
  if (snap.size > 0 && col === "profiles") {
    snap.docs.forEach((d) => console.log(`  profile [${d.id}]:`, d.data()));
  }
}

const user = await auth.getUserByEmail("ansariamaan8640@gmail.com");
console.log("\nAuth user ansariamaan8640@gmail.com:");
console.log("  UID:", user.uid);
console.log("  Custom claims:", user.customClaims);
