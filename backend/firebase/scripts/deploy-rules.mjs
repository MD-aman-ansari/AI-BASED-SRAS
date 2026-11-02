import fs from "node:fs";
import path from "node:path";
import { GoogleAuth } from "google-auth-library";

const keyFile = path.resolve("serviceAccountKey.json");
const rulesFile = path.resolve("../firestore.rules");

const auth = new GoogleAuth({
  keyFile,
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/firebase",
  ],
});

const client = await auth.getClient();
const projectId = "sfras-1b538";

console.log("Fetching current releases for project:", projectId);
try {
  const getReleaseRes = await client.request({
    url: `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`,
  });
  console.log("Current releases:", JSON.stringify(getReleaseRes.data, null, 2));
} catch (e) {
  console.error("Error fetching releases:", e.response?.data || e.message);
}

const rulesContent = fs.readFileSync(rulesFile, "utf8");
console.log("\nDeploying new ruleset from firestore.rules...");

try {
  // 1. Create Ruleset
  const createRes = await client.request({
    url: `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
    method: "POST",
    data: {
      source: {
        files: [
          {
            name: "firestore.rules",
            content: rulesContent,
          },
        ],
      },
    },
  });

  const rulesetName = createRes.data.name;
  console.log("Created ruleset:", rulesetName);

  // 2. Update release cloud.firestore
  const releaseName = `projects/${projectId}/releases/cloud.firestore`;
  const updateRes = await client.request({
    url: `https://firebaserules.googleapis.com/v1/${releaseName}`,
    method: "PATCH",
    data: {
      release: {
        name: releaseName,
        rulesetName: rulesetName,
      },
    },
  });

  console.log("Successfully updated release cloud.firestore to:", updateRes.data.rulesetName);
  console.log("✅ Firestore Security Rules successfully deployed to Firebase Cloud!");
} catch (err) {
  console.error("Failed to deploy ruleset:", err.response?.data || err.message);
}
