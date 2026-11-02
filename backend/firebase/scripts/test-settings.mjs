import fs from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const key = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
initializeApp({ credential: cert(key), projectId: "sfras-1b538" });
const db = getFirestore();

const snap = await db.collection("factory_settings").get();
snap.docs.forEach((d) => console.log("factory_settings doc:", d.id, d.data()));
