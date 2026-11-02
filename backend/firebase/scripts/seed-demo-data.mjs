import fs from "node:fs";
import path from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "sfras-1b538";

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
  console.error("\n❌ Firebase Admin Private Key (serviceAccountKey.json) is required for CLI seeding.");
  console.error("Please place your serviceAccountKey.json in backend/firebase/scripts/ or use the 'Seed College Demo Data' button in the Web UI Settings.");
  process.exit(1);
}

try {
  initializeApp({ credential, projectId });
} catch (initErr) {
  console.error("Firebase initializeApp error:", initErr.message);
  process.exit(1);
}

const firestore = getFirestore();

async function seedData() {
  console.log("Seeding College Demo Dataset into Firestore...");
  const now = new Date().toISOString();

  // 1. Factory Settings
  await firestore.collection("factory_settings").doc("main").set({
    id: true,
    workspace_name: "Smart Factory Resource Allocation (SRAS)",
    plant_location: "Industrial Corridor Sector 7, Plant 01",
    time_zone: "Asia/Kolkata",
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
    updated_at: now,
  }, { merge: true });
  console.log("✓ Initialized factory_settings/main");

  // 2. Task Counter
  await firestore.collection("counters").doc("production_tasks").set({ next: 104 }, { merge: true });
  console.log("✓ Initialized production_tasks counter");

  // 3. Materials
  const materials = [
    { id: "mat_steel_316l", sku: "MAT-STL-316", name: "316L Stainless Steel Rods", category: "Steel & Alloys", unit: "kg", quantity_on_hand: 550, quantity_reserved: 45, reorder_point: 100, is_active: true },
    { id: "mat_alum_6061", sku: "MAT-ALU-606", name: "6061-T6 Aluminum Billets", category: "Aluminum", unit: "kg", quantity_on_hand: 380, quantity_reserved: 30, reorder_point: 80, is_active: true },
    { id: "mat_brass_360", sku: "MAT-BRS-360", name: "C360 High-Tensile Brass Bar", category: "Brass & Bronze", unit: "kg", quantity_on_hand: 190, quantity_reserved: 0, reorder_point: 40, is_active: true },
    { id: "mat_sheet_galv", sku: "MAT-SHT-GAL", name: "Galvanized Steel Sheet 2mm", category: "Sheet Metal", unit: "sheets", quantity_on_hand: 220, quantity_reserved: 25, reorder_point: 50, is_active: true },
    { id: "mat_polymer_pc", sku: "MAT-POL-001", name: "High-Impact Polycarbonate Resin", category: "Polymers", unit: "kg", quantity_on_hand: 420, quantity_reserved: 0, reorder_point: 90, is_active: true },
  ];
  for (const m of materials) {
    await firestore.collection("materials").doc(m.id).set({ ...m, created_at: now, updated_at: now }, { merge: true });
  }
  console.log(`✓ Seeded ${materials.length} raw materials`);

  // 4. Machines
  const machines = [
    { id: "mach_cnc_01", machine_code: "M-CNC-01", name: "Haas 5-Axis VMC Center", machine_type: "CNC", location: "Bay 1 - High Precision", compatible_material_categories: ["Steel & Alloys", "Aluminum", "Brass & Bronze"], status: "available", is_active: true },
    { id: "mach_lathe_02", machine_code: "M-LATHE-02", name: "Mazak CNC Heavy Lathe", machine_type: "Lathe", location: "Bay 1 - Turning", compatible_material_categories: ["Steel & Alloys", "Brass & Bronze"], status: "available", is_active: true },
    { id: "mach_weld_03", machine_code: "M-WELD-03", name: "Panasonic Robotic Arc Welder", machine_type: "Welder", location: "Bay 2 - Fabrication", compatible_material_categories: ["Steel & Alloys", "Sheet Metal"], status: "available", is_active: true },
    { id: "mach_assm_04", machine_code: "M-ASSM-04", name: "Vision Automated Assembly Cell", machine_type: "Assembly", location: "Bay 3 - Packaging", compatible_material_categories: ["Polymers", "Steel & Alloys"], status: "available", is_active: true },
  ];
  for (const m of machines) {
    await firestore.collection("machines").doc(m.id).set({ ...m, created_at: now, updated_at: now }, { merge: true });
  }
  console.log(`✓ Seeded ${machines.length} machines`);

  // 5. Employees
  const employees = [
    { id: "emp_rajesh", employee_number: "EMP-101", first_name: "Rajesh", last_name: "Sharma", email: "rajesh.sharma@factory.local", job_title: "Master CNC Technician", skills: ["CNC", "Precision Milling", "G-Code Optimization"], shift_name: "Shift A", workload_percent: 45, is_available: true, is_active: true },
    { id: "emp_priya", employee_number: "EMP-102", first_name: "Priya", last_name: "Patel", email: "priya.patel@factory.local", job_title: "Senior QA & Assembly Specialist", skills: ["Assembly", "Quality Control", "ISO Inspection"], shift_name: "Shift A", workload_percent: 60, is_available: true, is_active: true },
    { id: "emp_amit", employee_number: "EMP-103", first_name: "Amit", last_name: "Verma", email: "amit.verma@factory.local", job_title: "Welding & Fabrication Tech", skills: ["MIG/TIG Welding", "Sheet Metal", "Fabrication"], shift_name: "Shift B", workload_percent: 30, is_available: true, is_active: true },
    { id: "emp_sneha", employee_number: "EMP-104", first_name: "Sneha", last_name: "Kulkarni", email: "sneha.k@factory.local", job_title: "Automation Systems Engineer", skills: ["CNC", "Robotics", "Tool Setting"], shift_name: "Shift B", workload_percent: 55, is_available: true, is_active: true },
  ];
  for (const e of employees) {
    await firestore.collection("employees").doc(e.id).set({ ...e, created_at: now, updated_at: now }, { merge: true });
  }
  console.log(`✓ Seeded ${employees.length} employee technicians`);

  // 6. Production Tasks & Allocations
  const task1Id = "task_valve_body_01";
  const start1 = new Date(Date.now() - 3600000 * 6).toISOString();
  const end1 = new Date(Date.now() + 3600000 * 2).toISOString();
  await firestore.collection("production_tasks").doc(task1Id).set({
    id: task1Id,
    task_number: 101,
    title: "Cryogenic Flow Control Valve Run",
    description: "High-pressure stainless steel valve body machining with tight tolerance.",
    priority: "high",
    status: "in_progress",
    required_skills: ["CNC"],
    required_machine_type: "CNC",
    material_id: "mat_steel_316l",
    required_material_quantity: 45,
    planned_quantity: 120,
    produced_quantity: 65,
    start_at: start1,
    end_at: end1,
    created_by: "system_seed",
    created_at: start1,
    updated_at: now,
  }, { merge: true });

  await firestore.collection("resource_allocations").doc("alloc_task_101").set({
    id: "alloc_task_101",
    task_id: task1Id,
    employee_id: "emp_rajesh",
    machine_id: "mach_cnc_01",
    material_id: "mat_steel_316l",
    start_at: start1,
    end_at: end1,
    reserved_material_quantity: 45,
    consumed_material_quantity: 24.375,
    status: "in_progress",
    allocation_reasons: {
      employee: "Skill matched [CNC]; Workload 45% (below 85% limit); Shift A active.",
      machine: "Machine M-CNC-01 verified available; Material category 'Steel & Alloys' compatible.",
      material: "Reserved 45 kg of 316L Stainless Steel Rods (Above 100 kg reorder threshold).",
    },
    created_at: start1,
  }, { merge: true });

  const task2Id = "task_flange_02";
  const start2 = new Date(Date.now() + 3600000 * 4).toISOString();
  const end2 = new Date(Date.now() + 3600000 * 10).toISOString();
  await firestore.collection("production_tasks").doc(task2Id).set({
    id: task2Id,
    task_number: 102,
    title: "Aerospace Bracket Flange Batch",
    description: "Lightweight 6061-T6 structural flange fabrication.",
    priority: "medium",
    status: "scheduled",
    required_skills: ["CNC"],
    required_machine_type: "CNC",
    material_id: "mat_alum_6061",
    required_material_quantity: 30,
    planned_quantity: 80,
    produced_quantity: 0,
    start_at: start2,
    end_at: end2,
    created_by: "system_seed",
    created_at: now,
    updated_at: now,
  }, { merge: true });

  await firestore.collection("resource_allocations").doc("alloc_task_102").set({
    id: "alloc_task_102",
    task_id: task2Id,
    employee_id: "emp_sneha",
    machine_id: "mach_cnc_01",
    material_id: "mat_alum_6061",
    start_at: start2,
    end_at: end2,
    reserved_material_quantity: 30,
    consumed_material_quantity: 0,
    status: "reserved",
    allocation_reasons: {
      employee: "Skill matched [CNC]; Assigned to Sneha Kulkarni (Workload 55%); No schedule overlap.",
      machine: "Machine M-CNC-01 available after Task #101 finishes; Aluminum compatible.",
      material: "Reserved 30 kg of 6061-T6 Aluminum; 350 kg available stock verified.",
    },
    created_at: now,
  }, { merge: true });
  console.log("✓ Seeded sample production tasks and resource reservations");

  // 7. Production Records
  const rec1Id = "rec_01";
  await firestore.collection("production_records").doc(rec1Id).set({
    id: rec1Id,
    task_id: task1Id,
    good_units: 40,
    rejected_units: 2,
    notes: "Shift A morning batch inspected: dimensions within ±0.02mm tolerance.",
    recorded_by: "system_seed",
    recorded_at: new Date(Date.now() - 3600000 * 3).toISOString(),
  }, { merge: true });

  const rec2Id = "rec_02";
  await firestore.collection("production_records").doc(rec2Id).set({
    id: rec2Id,
    task_id: task1Id,
    good_units: 23,
    rejected_units: 0,
    notes: "Post-lunch run completed smoothly with zero rework.",
    recorded_by: "system_seed",
    recorded_at: new Date(Date.now() - 3600000 * 1).toISOString(),
  }, { merge: true });
  console.log("✓ Seeded auditable production records");

  // 8. Notifications
  const notifs = [
    { id: "notif_welcome", title: "College Demo Dataset Loaded", message: "Standard factory demo resources (4 operators, 4 machines, 5 materials, 2 tasks) are ready for evaluation.", category: "system", is_read: false, created_at: now },
    { id: "notif_task1", title: "Smart Allocation Success", message: "Task #101 allocated to Rajesh Sharma (EMP-101) & Haas VMC (M-CNC-01) with zero scheduling conflicts.", category: "task", is_read: true, created_at: start1 },
    { id: "notif_stock", title: "Inventory Status Healthy", message: "All 5 raw materials are operating safely above configured reorder points.", category: "inventory", is_read: true, created_at: now },
  ];
  for (const n of notifs) {
    await firestore.collection("notifications").doc(n.id).set(n, { merge: true });
  }
  console.log("✓ Seeded system activity notifications");

  console.log("\n✅ SUCCESS: Complete College Demo Dataset seeded into Firestore!");
}

await seedData();
