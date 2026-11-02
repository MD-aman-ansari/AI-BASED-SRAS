import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit as limitQuery,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { firebaseConfig, hasFirebaseConfiguration } from "./firebase-config.js";

const COLLECTIONS = new Set([
  "profiles",
  "employees",
  "machines",
  "materials",
  "production_tasks",
  "resource_allocations",
  "production_records",
  "notifications",
  "factory_settings",
]);

const FUNCTION_NAMES = {
  create_production_task: "createProductionTask",
  start_production_task: "startProductionTask",
  cancel_production_task: "cancelProductionTask",
  record_production: "recordProduction",
  mark_notification_read: "markNotificationRead",
  update_production_task: "updateProductionTask",
  delete_resource: "deleteResource",
  save_resource: "saveResource",
  save_factory_settings: "saveFactorySettings",
};

export const DEFAULT_FACTORY_SETTINGS = {
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
};

export function formatFirebaseError(error) {
  if (!error) return "";
  const code = error.code || "";
  const msg = error.message || String(error);

  if (code === "auth/invalid-credential" || msg.includes("auth/invalid-credential") || code === "auth/wrong-password") {
    return "Invalid email or password. Please verify your credentials and try again.";
  }
  if (code === "auth/user-not-found" || msg.includes("auth/user-not-found")) {
    return "No factory account found with this email. Please check the email or contact your administrator.";
  }
  if (code === "auth/too-many-requests" || msg.includes("auth/too-many-requests")) {
    return "Account access is temporarily restricted due to multiple failed login attempts. Please wait a few moments or reset your password.";
  }
  if (code === "auth/network-request-failed" || msg.includes("auth/network-request-failed")) {
    return "Network connection error. Please verify your internet connection and Firebase status.";
  }
  if (code === "auth/invalid-email" || msg.includes("auth/invalid-email")) {
    return "Please enter a valid work email address.";
  }
  if (code === "permission-denied" || msg.includes("permission-denied")) {
    return "Access Denied: You do not have Factory Administrator privileges to perform this action.";
  }
  if (msg.includes("Document not found")) {
    return "Factory record was not found in Firestore.";
  }
  return msg.replace(/^Firebase:\s*/i, "").replace(/\s*\(auth\/[a-z0-9-]+\)\.?/i, "");
}

function authUser(user) {
  if (!user) return null;
  return {
    id: user.uid,
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    emailVerified: Boolean(user.emailVerified),
    getIdTokenResult: (forceRefresh) => user.getIdTokenResult(forceRefresh),
    getIdToken: (forceRefresh) => user.getIdToken(forceRefresh),
    _rawUser: user,
  };
}

function serialize(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}

function rows(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...serialize(item.data()) }));
}

function overlaps(start, end, allocation) {
  const allocStart = Date.parse(allocation.start_at);
  const allocEnd = Date.parse(allocation.end_at);
  return start < allocEnd && allocStart < end;
}

function isAllocationFree(allocations, field, id, start, end) {
  return !allocations.some((allocation) =>
    allocation[field] === id &&
    ["reserved", "in_progress"].includes(allocation.status) &&
    overlaps(start, end, allocation)
  );
}

// Client-side fallback transaction logic if Cloud Functions are not deployed (e.g. Firebase Spark free tier)
async function executeClientFallback(db, auth, action, params) {
  const currentUid = auth.currentUser?.uid || "system";

  if (action === "create_production_task") {
    const input = params || {};
    const title = (input.p_title || "").trim();
    const description = (input.p_description || "").trim();
    const priority = input.p_priority || "medium";
    const skills = Array.isArray(input.p_required_skills) ? input.p_required_skills : [];
    const machineType = (input.p_required_machine_type || "").trim();
    const materialId = input.p_material_id;
    const materialQuantity = Number(input.p_required_material_quantity);
    const plannedQuantity = Number(input.p_planned_quantity);
    const start = Date.parse(input.p_start_at);
    const end = Date.parse(input.p_end_at);

    if (end <= start) throw new Error("End time must be after start time.");

    const taskRef = doc(collection(db, "production_tasks"));
    const allocationRef = doc(collection(db, "resource_allocations"));
    const counterRef = doc(db, "counters", "production_tasks");

    return await runTransaction(db, async (transaction) => {
      const [empSnap, machSnap, matSnap, allocSnap, setSnap, cntSnap] = await Promise.all([
        transaction.get(query(collection(db, "employees"), where("is_active", "==", true))),
        transaction.get(query(collection(db, "machines"), where("is_active", "==", true))),
        transaction.get(doc(db, "materials", materialId)),
        transaction.get(query(collection(db, "resource_allocations"), where("status", "in", ["reserved", "in_progress"]))),
        transaction.get(doc(db, "factory_settings", "main")),
        transaction.get(counterRef),
      ]);

      const employees = rows(empSnap);
      const machines = rows(machSnap);
      const allocations = rows(allocSnap);
      const settings = { ...DEFAULT_FACTORY_SETTINGS, ...(setSnap.exists() ? setSnap.data() : {}) };
      const material = matSnap.exists() ? { id: matSnap.id, ...matSnap.data() } : null;

      if (!material || !material.is_active) throw new Error("Selected material is currently inactive or not found.");

      let availableStock = Number(material.quantity_on_hand || 0) - Number(material.quantity_reserved || 0);
      const safetyBuffer = settings.reserve_reorder_stock ? Number(material.reorder_point || 0) : 0;
      const netAvailable = availableStock - safetyBuffer;

      if (netAvailable < materialQuantity) {
        throw new Error(
          `Insufficient stock for ${material.name}. Required: ${materialQuantity} ${material.unit}, Free: ${Math.max(0, netAvailable)} ${material.unit} (Safety buffer: ${safetyBuffer} ${material.unit}).`
        );
      }

      const employee = employees
        .filter((c) => c.is_active && c.is_available &&
          Number(c.workload_percent || 0) <= Number(settings.max_employee_workload_percent ?? 85) &&
          (!settings.prioritize_skill_match || skills.every((s) => (c.skills || []).includes(s))) &&
          isAllocationFree(allocations, "employee_id", c.id, start, end))
        .sort((a, b) => Number(a.workload_percent || 0) - Number(b.workload_percent || 0) ||
          String(a.employee_number || "").localeCompare(String(b.employee_number || "")))[0];

      if (!employee) {
        const activeEmps = employees.filter((c) => c.is_active && c.is_available);
        const overlapCount = activeEmps.filter((c) => !isAllocationFree(allocations, "employee_id", c.id, start, end)).length;
        const skillMissing = activeEmps.filter((c) => settings.prioritize_skill_match && !skills.every((s) => (c.skills || []).includes(s))).length;
        const workloadHigh = activeEmps.filter((c) => Number(c.workload_percent || 0) > Number(settings.max_employee_workload_percent ?? 85)).length;
        const issues = [];
        if (overlapCount) issues.push(`${overlapCount} operator(s) booked for an overlapping task`);
        if (skillMissing) issues.push(`${skillMissing} operator(s) lack required skills [${skills.join(", ")}]`);
        if (workloadHigh) issues.push(`${workloadHigh} operator(s) exceed maximum workload (${settings.max_employee_workload_percent}%)`);
        throw new Error(`Smart allocation unable to find an operator: ${issues.join("; ") || "Check employee availability and skills"}.`);
      }

      const machine = machines
        .filter((c) => c.is_active && c.status === "available" &&
          String(c.machine_type || "").toLowerCase() === machineType.toLowerCase() &&
          (c.compatible_material_categories || []).some((cat) => String(cat).toLowerCase() === String(material.category).toLowerCase()) &&
          isAllocationFree(allocations, "machine_id", c.id, start, end))
        .sort((a, b) => String(a.machine_code || "").localeCompare(String(b.machine_code || "")))[0];

      if (!machine) {
        const activeMachs = machines.filter((c) => c.is_active);
        const overlapCount = activeMachs.filter((c) => !isAllocationFree(allocations, "machine_id", c.id, start, end)).length;
        const statusIssue = activeMachs.filter((c) => c.status !== "available").length;
        const compatIssue = activeMachs.filter((c) => !(c.compatible_material_categories || []).some((cat) => String(cat).toLowerCase() === String(material.category).toLowerCase())).length;
        const typeIssue = activeMachs.filter((c) => String(c.machine_type || "").toLowerCase() !== machineType.toLowerCase()).length;
        const issues = [];
        if (overlapCount) issues.push(`${overlapCount} machine(s) booked during this time window`);
        if (statusIssue) issues.push(`${statusIssue} machine(s) under maintenance or in-use`);
        if (compatIssue) issues.push(`${compatIssue} machine(s) incompatible with "${material.category}"`);
        if (typeIssue) issues.push(`${typeIssue} machine(s) do not match type "${machineType}"`);
        throw new Error(`Smart allocation unable to find a machine: ${issues.join("; ") || "Check machine status and material compatibility"}.`);
      }

      const now = new Date().toISOString();
      const taskNumber = Number(cntSnap.exists() ? cntSnap.data().next || 1 : 1);
      const employeeReason = `Skill match verified (${skills.length ? skills.join(", ") : "General"}); Workload: ${employee.workload_percent}%; Zero schedule conflict.`;
      const machineReason = `Machine type "${machine.machine_type}" matched; Material category "${material.category}" compatible; Status available; Zero conflict.`;
      const materialReason = `Reserved ${materialQuantity} ${material.unit} of "${material.name}". Safety buffer maintained.`;

      const task = {
        id: taskRef.id,
        task_number: taskNumber,
        title,
        description,
        priority,
        status: "scheduled",
        required_skills: skills,
        required_machine_type: machineType,
        material_id: material.id,
        required_material_quantity: materialQuantity,
        planned_quantity: plannedQuantity,
        produced_quantity: 0,
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        created_by: currentUid,
        created_at: now,
        updated_at: now,
      };

      transaction.set(counterRef, { next: taskNumber + 1 });
      transaction.set(taskRef, task);
      transaction.set(allocationRef, {
        id: allocationRef.id,
        task_id: taskRef.id,
        employee_id: employee.id,
        machine_id: machine.id,
        material_id: material.id,
        start_at: task.start_at,
        end_at: task.end_at,
        reserved_material_quantity: materialQuantity,
        consumed_material_quantity: 0,
        status: "reserved",
        allocation_reasons: {
          employee: employeeReason,
          machine: machineReason,
          material: materialReason,
        },
        created_at: now,
      });

      transaction.update(doc(db, "materials", material.id), {
        quantity_reserved: Number(material.quantity_reserved || 0) + materialQuantity,
        updated_at: now,
      });
      transaction.update(doc(db, "employees", employee.id), { last_allocated_at: now });
      transaction.update(doc(db, "machines", machine.id), { last_allocated_at: now });

      if (settings.conflict_notifications) {
        const notifRef = doc(collection(db, "notifications"));
        transaction.set(notifRef, {
          title: "Task scheduled",
          message: `${task.title} was assigned to ${employee.first_name} ${employee.last_name} on ${machine.machine_code}. Reason: ${employeeReason}`,
          category: "task",
          entity_type: "production_task",
          entity_id: task.id,
          is_read: false,
          created_at: now,
        });
      }

      return { task, employee, machine, reasons: { employee: employeeReason, machine: machineReason, material: materialReason } };
    });
  }

  if (action === "start_production_task") {
    const taskId = params?.p_task_id;
    return await runTransaction(db, async (transaction) => {
      const taskRef = doc(db, "production_tasks", taskId);
      const taskSnap = await transaction.get(taskRef);
      if (!taskSnap.exists()) throw new Error("Task not found.");
      const task = taskSnap.data();
      if (task.status !== "scheduled") throw new Error("Task is not in scheduled state.");

      const allocSnap = await transaction.get(query(collection(db, "resource_allocations"), where("task_id", "==", taskId)));
      if (allocSnap.empty) throw new Error("Task has no resource allocation.");

      const now = new Date().toISOString();
      transaction.update(taskRef, { status: "in_progress", updated_at: now });
      transaction.update(allocSnap.docs[0].ref, { status: "in_progress" });
      return { success: true };
    });
  }

  if (action === "record_production") {
    const taskId = params?.p_task_id;
    const goodUnits = Number(params?.p_good_units || 0);
    const rejectedUnits = Number(params?.p_rejected_units || 0);
    const notes = params?.p_notes || "";
    const total = goodUnits + rejectedUnits;
    if (total < 1) throw new Error("Enter at least one good or rejected unit.");

    return await runTransaction(db, async (transaction) => {
      const taskRef = doc(db, "production_tasks", taskId);
      const taskSnap = await transaction.get(taskRef);
      if (!taskSnap.exists()) throw new Error("Task not found.");
      const task = taskSnap.data();
      if (["completed", "cancelled"].includes(task.status)) throw new Error("Task is already closed.");

      if (Number(task.produced_quantity || 0) + total > Number(task.planned_quantity)) {
        throw new Error("Recorded output cannot exceed planned quantity.");
      }

      const allocSnap = await transaction.get(query(collection(db, "resource_allocations"), where("task_id", "==", taskId)));
      if (allocSnap.empty) throw new Error("Task has no resource allocation.");
      const allocation = allocSnap.docs[0].data();

      const matRef = doc(db, "materials", allocation.material_id);
      const matSnap = await transaction.get(matRef);
      if (!matSnap.exists()) throw new Error("Allocated material no longer exists.");
      const material = matSnap.data();

      const produced = Number(task.produced_quantity || 0) + total;
      const consumed = Math.round(Number(allocation.reserved_material_quantity) * produced / Number(task.planned_quantity) * 1000) / 1000;
      const delta = consumed - Number(allocation.consumed_material_quantity || 0);
      const completed = produced >= Number(task.planned_quantity);
      const now = new Date().toISOString();

      const recordRef = doc(collection(db, "production_records"));
      transaction.set(recordRef, {
        id: recordRef.id,
        task_id: taskId,
        good_units: goodUnits,
        rejected_units: rejectedUnits,
        notes,
        recorded_by: currentUid,
        recorded_at: now,
      });

      transaction.update(matRef, {
        quantity_on_hand: Number(material.quantity_on_hand || 0) - delta,
        quantity_reserved: Number(material.quantity_reserved || 0) - delta,
        updated_at: now,
      });

      transaction.update(allocSnap.docs[0].ref, {
        consumed_material_quantity: consumed,
        status: completed ? "completed" : "in_progress",
      });

      transaction.update(taskRef, {
        produced_quantity: produced,
        status: completed ? "completed" : "in_progress",
        updated_at: now,
      });

      return { success: true, completed, produced_quantity: produced };
    });
  }

  if (action === "cancel_production_task") {
    const taskId = params?.p_task_id;
    return await runTransaction(db, async (transaction) => {
      const taskRef = doc(db, "production_tasks", taskId);
      const taskSnap = await transaction.get(taskRef);
      if (!taskSnap.exists()) throw new Error("Task not found.");
      const task = taskSnap.data();
      if (task.status === "completed") throw new Error("Completed task cannot be cancelled.");

      const allocSnap = await transaction.get(query(collection(db, "resource_allocations"), where("task_id", "==", taskId)));
      const now = new Date().toISOString();

      if (!allocSnap.empty) {
        const allocation = allocSnap.docs[0].data();
        if (["reserved", "in_progress"].includes(allocation.status)) {
          const matRef = doc(db, "materials", allocation.material_id);
          const matSnap = await transaction.get(matRef);
          if (matSnap.exists()) {
            const unconsumed = Number(allocation.reserved_material_quantity || 0) - Number(allocation.consumed_material_quantity || 0);
            transaction.update(matRef, {
              quantity_reserved: Math.max(0, Number(matSnap.data().quantity_reserved || 0) - unconsumed),
              updated_at: now,
            });
          }
          transaction.update(allocSnap.docs[0].ref, { status: "cancelled" });
        }
      }

      transaction.update(taskRef, { status: "cancelled", updated_at: now });
      const notifRef = doc(collection(db, "notifications"));
      transaction.set(notifRef, {
        title: "Task cancelled",
        message: `${task.title} was cancelled and unconsumed reserved stock was released.`,
        category: "task",
        entity_type: "production_task",
        entity_id: taskId,
        is_read: false,
        created_at: now,
      });

      return { success: true };
    });
  }

  if (action === "mark_notification_read") {
    const notifId = params?.p_notification_id;
    await updateDoc(doc(db, "notifications", notifId), { is_read: true });
    return { success: true };
  }

  if (action === "update_production_task") {
    const { task_id, ...updates } = params || {};
    await updateDoc(doc(db, "production_tasks", task_id), { ...updates, updated_at: new Date().toISOString() });
    return { success: true };
  }

  throw new Error(`Unsupported fallback RPC action: ${action}`);
}

function createQuery(db, functions, auth, collectionName) {
  if (!COLLECTIONS.has(collectionName)) throw new Error(`Unknown Firebase collection: ${collectionName}`);
  let operation = "read";
  let payload = null;
  let filters = [];
  let ordering = null;
  let maxItems = null;
  let single = null;

  const builder = {
    select() { return builder; },
    order(field, options = {}) { ordering = [field, options.ascending !== false]; return builder; },
    eq(field, value) { filters.push([field, value]); return builder; },
    limit(count) { maxItems = count; return builder; },
    maybeSingle() { single = "maybe"; return builder; },
    single() { single = "required"; return builder; },
    insert(value) { operation = "insert"; payload = value; return builder; },
    update(value) { operation = "update"; payload = value; return builder; },
    upsert(value) { operation = "upsert"; payload = value; return builder; },
    delete() { operation = "delete"; return builder; },
    async execute() {
      try {
        if (operation === "read") {
          if (collectionName === "profiles" && single && filters.length === 1 && filters[0][0] === "id") {
            const snapshot = await getDoc(doc(db, collectionName, String(filters[0][1])));
            if (!snapshot.exists() && single === "required") throw new Error("Document not found.");
            return { data: snapshot.exists() ? { id: snapshot.id, ...serialize(snapshot.data()) } : null, error: null };
          }
          let reference = collection(db, collectionName);
          let constraints = filters.map(([field, value]) => where(field, "==", value));
          if (ordering) constraints.push(orderBy(ordering[0], ordering[1] ? "asc" : "desc"));
          if (maxItems !== null) constraints.push(limitQuery(maxItems));
          const snapshot = await getDocs(constraints.length ? query(reference, ...constraints) : reference);
          let rows = snapshot.docs.map((item) => ({ id: item.id, ...serialize(item.data()) }));
          if (ordering) {
            const [field, ascending] = ordering;
            rows.sort((a, b) => {
              const left = a[field] ?? "";
              const right = b[field] ?? "";
              const comparison = left < right ? -1 : left > right ? 1 : 0;
              return ascending ? comparison : -comparison;
            });
          }
          if (single) {
            if (rows.length > 1 || (single === "required" && rows.length === 0)) {
              throw new Error(rows.length ? "Expected one document, received more than one." : "Document not found.");
            }
            return { data: rows[0] || null, error: null };
          }
          return { data: rows, error: null };
        }

        const idFilter = filters.find(([field]) => field === "id");
        const docId = idFilter ? idFilter[1] : payload?.id;

        // Try Cloud Function first, fall back to direct Firestore write if Cloud Function is unavailable
        if (operation === "insert") {
          try {
            await httpsCallable(functions, FUNCTION_NAMES.save_resource)({ collection: collectionName, payload });
          } catch (fnErr) {
            if (fnErr.code === "not-found" || fnErr.code === "unavailable") {
              const docRef = docId ? doc(db, collectionName, String(docId)) : doc(collection(db, collectionName));
              const now = new Date().toISOString();
              await setDoc(docRef, { ...payload, id: docRef.id, created_at: now, updated_at: now });
            } else {
              throw fnErr;
            }
          }
        } else if (operation === "upsert" && collectionName === "factory_settings") {
          try {
            await httpsCallable(functions, FUNCTION_NAMES.save_factory_settings)(payload);
          } catch (fnErr) {
            if (fnErr.code === "not-found" || fnErr.code === "unavailable") {
              await setDoc(doc(db, "factory_settings", "main"), { ...payload, id: true, updated_at: new Date().toISOString() }, { merge: true });
            } else {
              throw fnErr;
            }
          }
        } else if (operation === "upsert" && collectionName === "profiles") {
          const profileId = payload?.id || filters.find(([field]) => field === "id")?.[1];
          if (!profileId) throw new Error("A profile ID is required for profile upsert.");
          await setDoc(doc(db, "profiles", String(profileId)), payload, { merge: true });
        } else if (operation === "upsert") {
          const targetRef = docId ? doc(db, collectionName, String(docId)) : doc(collection(db, collectionName));
          await setDoc(targetRef, { ...payload, updated_at: new Date().toISOString() }, { merge: true });
        } else if (!idFilter) {
          throw new Error("A document ID is required for this operation.");
        } else if (collectionName === "production_tasks" && operation === "update") {
          try {
            await httpsCallable(functions, FUNCTION_NAMES.update_production_task)({
              task_id: idFilter[1],
              ...payload,
            });
          } catch (fnErr) {
            if (fnErr.code === "not-found" || fnErr.code === "unavailable") {
              await updateDoc(doc(db, "production_tasks", String(idFilter[1])), { ...payload, updated_at: new Date().toISOString() });
            } else {
              throw fnErr;
            }
          }
        } else if (operation === "update") {
          try {
            await httpsCallable(functions, FUNCTION_NAMES.save_resource)({
              collection: collectionName,
              id: idFilter[1],
              payload,
            });
          } catch (fnErr) {
            if (fnErr.code === "not-found" || fnErr.code === "unavailable") {
              await updateDoc(doc(db, collectionName, String(idFilter[1])), { ...payload, updated_at: new Date().toISOString() });
            } else {
              throw fnErr;
            }
          }
        } else if (operation === "delete") {
          try {
            await httpsCallable(functions, FUNCTION_NAMES.delete_resource)({ collection: collectionName, id: idFilter[1] });
          } catch (fnErr) {
            if (fnErr.code === "not-found" || fnErr.code === "unavailable") {
              await deleteDoc(doc(db, collectionName, String(idFilter[1])));
            } else {
              throw fnErr;
            }
          }
        } else {
          throw new Error(`Unsupported Firebase operation: ${operation}`);
        }
        return { data: null, error: null };
      } catch (error) {
        return { data: null, error: new Error(formatFirebaseError(error)) };
      }
    },
    then(resolve, reject) { return builder.execute().then(resolve, reject); },
  };
  return builder;
}

export function createFirebaseClient() {
  if (!hasFirebaseConfiguration()) {
    throw new Error("Set the Firebase web app values in frontend/.env before starting the app.");
  }
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || "us-central1");

  return {
    from(collectionName) { return createQuery(db, functions, auth, collectionName); },
    async rpc(name, params) {
      const functionName = FUNCTION_NAMES[name];
      if (!functionName) return { data: null, error: new Error(`Unknown Firebase function: ${name}`) };

      try {
        const result = await httpsCallable(functions, functionName)(params);
        return { data: result.data, error: null };
      } catch (fnError) {
        // If Cloud Function returned a domain validation error (e.g. invalid arguments or precondition)
        if (fnError.code && fnError.code !== "not-found" && fnError.code !== "unavailable" && fnError.code !== "internal") {
          return { data: null, error: new Error(formatFirebaseError(fnError)) };
        }
        // If the Cloud Function is not found (e.g., Spark plan without functions deployment) or unavailable:
        try {
          const fallbackData = await executeClientFallback(db, auth, name, params);
          return { data: fallbackData, error: null };
        } catch (fallbackError) {
          return { data: null, error: new Error(formatFirebaseError(fallbackError)) };
        }
      }
    },
    async seedDemoData() {
      const now = new Date().toISOString();
      const currentUid = auth.currentUser?.uid || "admin";

      // 1. Factory Settings
      await setDoc(doc(db, "factory_settings", "main"), {
        ...DEFAULT_FACTORY_SETTINGS,
        updated_at: now,
      }, { merge: true });

      // 2. Task Counter
      await setDoc(doc(db, "counters", "production_tasks"), { next: 104 }, { merge: true });

      // 3. Materials
      const materials = [
        { id: "mat_steel_316l", sku: "MAT-STL-316", name: "316L Stainless Steel Rods", category: "Steel & Alloys", unit: "kg", quantity_on_hand: 550, quantity_reserved: 45, reorder_point: 100, is_active: true },
        { id: "mat_alum_6061", sku: "MAT-ALU-606", name: "6061-T6 Aluminum Billets", category: "Aluminum", unit: "kg", quantity_on_hand: 380, quantity_reserved: 30, reorder_point: 80, is_active: true },
        { id: "mat_brass_360", sku: "MAT-BRS-360", name: "C360 High-Tensile Brass Bar", category: "Brass & Bronze", unit: "kg", quantity_on_hand: 190, quantity_reserved: 0, reorder_point: 40, is_active: true },
        { id: "mat_sheet_galv", sku: "MAT-SHT-GAL", name: "Galvanized Steel Sheet 2mm", category: "Sheet Metal", unit: "sheets", quantity_on_hand: 220, quantity_reserved: 25, reorder_point: 50, is_active: true },
        { id: "mat_polymer_pc", sku: "MAT-POL-001", name: "High-Impact Polycarbonate Resin", category: "Polymers", unit: "kg", quantity_on_hand: 420, quantity_reserved: 0, reorder_point: 90, is_active: true },
      ];
      for (const m of materials) {
        await setDoc(doc(db, "materials", m.id), { ...m, created_at: now, updated_at: now }, { merge: true });
      }

      // 4. Machines
      const machines = [
        { id: "mach_cnc_01", machine_code: "M-CNC-01", name: "Haas 5-Axis VMC Center", machine_type: "CNC", location: "Bay 1 - High Precision", compatible_material_categories: ["Steel & Alloys", "Aluminum", "Brass & Bronze"], status: "available", is_active: true },
        { id: "mach_lathe_02", machine_code: "M-LATHE-02", name: "Mazak CNC Heavy Lathe", machine_type: "Lathe", location: "Bay 1 - Turning", compatible_material_categories: ["Steel & Alloys", "Brass & Bronze"], status: "available", is_active: true },
        { id: "mach_weld_03", machine_code: "M-WELD-03", name: "Panasonic Robotic Arc Welder", machine_type: "Welder", location: "Bay 2 - Fabrication", compatible_material_categories: ["Steel & Alloys", "Sheet Metal"], status: "available", is_active: true },
        { id: "mach_assm_04", machine_code: "M-ASSM-04", name: "Vision Automated Assembly Cell", machine_type: "Assembly", location: "Bay 3 - Packaging", compatible_material_categories: ["Polymers", "Steel & Alloys"], status: "available", is_active: true },
      ];
      for (const m of machines) {
        await setDoc(doc(db, "machines", m.id), { ...m, created_at: now, updated_at: now }, { merge: true });
      }

      // 5. Employees
      const employees = [
        { id: "emp_rajesh", employee_number: "EMP-101", first_name: "Rajesh", last_name: "Sharma", email: "rajesh.sharma@factory.local", job_title: "Master CNC Technician", skills: ["CNC", "Precision Milling", "G-Code Optimization"], shift_name: "Shift A", workload_percent: 45, is_available: true, is_active: true },
        { id: "emp_priya", employee_number: "EMP-102", first_name: "Priya", last_name: "Patel", email: "priya.patel@factory.local", job_title: "Senior QA & Assembly Specialist", skills: ["Assembly", "Quality Control", "ISO Inspection"], shift_name: "Shift A", workload_percent: 60, is_available: true, is_active: true },
        { id: "emp_amit", employee_number: "EMP-103", first_name: "Amit", last_name: "Verma", email: "amit.verma@factory.local", job_title: "Welding & Fabrication Tech", skills: ["MIG/TIG Welding", "Sheet Metal", "Fabrication"], shift_name: "Shift B", workload_percent: 30, is_available: true, is_active: true },
        { id: "emp_sneha", employee_number: "EMP-104", first_name: "Sneha", last_name: "Kulkarni", email: "sneha.k@factory.local", job_title: "Automation Systems Engineer", skills: ["CNC", "Robotics", "Tool Setting"], shift_name: "Shift B", workload_percent: 55, is_available: true, is_active: true },
      ];
      for (const e of employees) {
        await setDoc(doc(db, "employees", e.id), { ...e, created_at: now, updated_at: now }, { merge: true });
      }

      // 6. Sample Production Tasks & Allocations
      const task1Id = "task_valve_body_01";
      const start1 = new Date(Date.now() - 3600000 * 6).toISOString();
      const end1 = new Date(Date.now() + 3600000 * 2).toISOString();
      await setDoc(doc(db, "production_tasks", task1Id), {
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
        created_by: currentUid,
        created_at: start1,
        updated_at: now,
      }, { merge: true });

      await setDoc(doc(db, "resource_allocations", "alloc_task_101"), {
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
      await setDoc(doc(db, "production_tasks", task2Id), {
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
        created_by: currentUid,
        created_at: now,
        updated_at: now,
      }, { merge: true });

      await setDoc(doc(db, "resource_allocations", "alloc_task_102"), {
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

      // 7. Sample Production Records
      const rec1Id = "rec_01";
      await setDoc(doc(db, "production_records", rec1Id), {
        id: rec1Id,
        task_id: task1Id,
        good_units: 40,
        rejected_units: 2,
        notes: "Shift A morning batch inspected: dimensions within ±0.02mm tolerance.",
        recorded_by: currentUid,
        recorded_at: new Date(Date.now() - 3600000 * 3).toISOString(),
      }, { merge: true });

      const rec2Id = "rec_02";
      await setDoc(doc(db, "production_records", rec2Id), {
        id: rec2Id,
        task_id: task1Id,
        good_units: 23,
        rejected_units: 0,
        notes: "Post-lunch run completed smoothly with zero rework.",
        recorded_by: currentUid,
        recorded_at: new Date(Date.now() - 3600000 * 1).toISOString(),
      }, { merge: true });

      // 8. Notifications
      const notifs = [
        { id: "notif_welcome", title: "College Demo Dataset Loaded", message: "Standard factory demo resources (4 operators, 4 machines, 5 materials, 2 tasks) are ready for evaluation.", category: "system", is_read: false, created_at: now },
        { id: "notif_task1", title: "Smart Allocation Success", message: "Task #101 allocated to Rajesh Sharma (EMP-101) & Haas VMC (M-CNC-01) with zero scheduling conflicts.", category: "task", is_read: true, created_at: start1 },
        { id: "notif_stock", title: "Inventory Status Healthy", message: "All 5 raw materials are operating safely above configured reorder points.", category: "inventory", is_read: true, created_at: now },
      ];
      for (const n of notifs) {
        await setDoc(doc(db, "notifications", n.id), n, { merge: true });
      }

      return { success: true };
    },
    auth: {
      signInWithPassword({ email, password }) {
        return signInWithEmailAndPassword(auth, email, password)
          .then((credential) => ({ data: { session: { user: authUser(credential.user) } }, error: null }))
          .catch((error) => ({ data: null, error: new Error(formatFirebaseError(error)) }));
      },
      resetPasswordForEmail(email, options = {}) {
        const actionCodeSettings = options.redirectTo ? { url: options.redirectTo, handleCodeInApp: false } : undefined;
        return sendPasswordResetEmail(auth, email, actionCodeSettings)
          .then(() => ({ error: null }))
          .catch((error) => ({ error: new Error(formatFirebaseError(error)) }));
      },
      signOut() {
        return signOut(auth)
          .then(() => ({ error: null }))
          .catch((error) => ({ error: new Error(formatFirebaseError(error)) }));
      },
      getSession() {
        return new Promise((resolve) => {
          let unsubscribe;
          unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve({ data: { session: user ? { user: authUser(user) } : null }, error: null });
          }, (error) => resolve({ data: { session: null }, error: new Error(formatFirebaseError(error)) }));
        });
      },
      onAuthStateChange(callback) {
        let initial = true;
        const unsubscribe = onAuthStateChanged(auth, (user) => {
          callback(initial ? "INITIAL_SESSION" : user ? "SIGNED_IN" : "SIGNED_OUT", user ? { user: authUser(user) } : null);
          initial = false;
        });
        return { data: { subscription: { unsubscribe } } };
      },
    },
  };
}

export { hasFirebaseConfiguration };
