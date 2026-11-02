import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, doc, getDoc, query, where, orderBy, limit } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAKKoqDrlvY1NRLnh6LRtf5kNqhUbUBBgY",
  authDomain: "sfras-1b538.firebaseapp.com",
  projectId: "sfras-1b538",
  appId: "1:850062847943:web:d59e1a86ac4874fe0fb3e2",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

try {
  console.log("Signing in as ansariamaan8640@gmail.com...");
  const cred = await signInWithEmailAndPassword(auth, "ansariamaan8640@gmail.com", "Admin@12345");
  console.log("Signed in successfully! UID:", cred.user.uid);
  
  const token = await cred.user.getIdTokenResult(true);
  console.log("Claims:", token.claims);

  const collections = [
    "profiles",
    "employees",
    "machines",
    "materials",
    "production_tasks",
    "resource_allocations",
    "production_records",
    "notifications",
    "factory_settings"
  ];

  for (const c of collections) {
    try {
      if (c === "profiles") {
        const snap = await getDoc(doc(db, "profiles", cred.user.uid));
        console.log(`[profiles doc] exists: ${snap.exists()}, data:`, snap.data());
      } else if (c === "factory_settings") {
        const snap = await getDocs(query(collection(db, c), where("id", "==", true)));
        console.log(`[${c}] OK! count: ${snap.size}`);
      } else {
        const snap = await getDocs(collection(db, c));
        console.log(`[${c}] OK! count: ${snap.size}`);
      }
    } catch (err) {
      console.error(`❌ [${c}] ERROR: [code=${err.code}] ${err.message}`);
    }
  }

} catch (err) {
  console.error("Auth error:", err.code, err.message);
}
