import fs from "node:fs";
import path from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const keyFile = path.resolve("../backend/firebase/scripts/serviceAccountKey.json");
const json = JSON.parse(fs.readFileSync(keyFile, "utf8"));
initializeApp({ credential: cert(json), projectId: "sfras-1b538" });

const auth = getAuth();
const user = await auth.getUserByEmail("ansariamaan8640@gmail.com");
console.log("Admin SDK user customClaims:", user.customClaims);
