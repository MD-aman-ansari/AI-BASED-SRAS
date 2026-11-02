import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const db = getFirestore();
const auth = getAuth();
const RESOURCE_COLLECTIONS = new Set(["employees", "machines", "materials"]);
const UNIQUE_FIELDS = {
  employees: "employee_number",
  machines: "machine_code",
  materials: "sku",
};
const DEFAULT_SETTINGS = {
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
};
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const ACTIVE_ALLOCATION_STATES = new Set(["reserved", "in_progress"]);

function requireAdmin(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  if (request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "Factory administrator access is required.");
  }
  return request.auth.uid;
}

function fail(message, code = "failed-precondition") {
  throw new HttpsError(code, message);
}

function cleanText(value, label, { required = false, max = 2000 } = {}) {
  if (typeof value !== "string") fail(`${label} must be text.`, "invalid-argument");
  const text = value.trim();
  if (required && !text) fail(`${label} is required.`, "invalid-argument");
  if (text.length > max) fail(`${label} is too long.`, "invalid-argument");
  return text;
}

function finiteNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    fail(`${label} must be between ${min} and ${max}.`, "invalid-argument");
  }
  return number;
}

function integerNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  const number = finiteNumber(value, label, { min, max });
  if (!Number.isInteger(number)) fail(`${label} must be a whole number.`, "invalid-argument");
  return number;
}

function dateMillis(value, label) {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) fail(`${label} must be a valid date.`, "invalid-argument");
  return millis;
}

function row(snapshot) {
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

function rows(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function overlaps(start, end, allocation) {
  return start < Date.parse(allocation.end_at) && Date.parse(allocation.start_at) < end;
}

function availableAllocations(allocations, field, id, start, end) {
  return !allocations.some((allocation) =>
    allocation[field] === id &&
    ACTIVE_ALLOCATION_STATES.has(allocation.status) &&
    overlaps(start, end, allocation));
}

function newNotification(title, message, category, entityType, entityId) {
  return {
    title,
    message,
    category,
    entity_type: entityType,
    entity_id: entityId,
    is_read: false,
    created_at: new Date().toISOString(),
  };
}

export const createProductionTask = onCall(async (request) => {
  const uid = requireAdmin(request);
  const input = request.data || {};
  const title = cleanText(input.p_title, "Task title", { required: true, max: 200 });
  const description = cleanText(input.p_description || "", "Description");
  const priority = input.p_priority;
  if (!PRIORITIES.has(priority)) fail("Invalid priority.", "invalid-argument");
  const skills = Array.isArray(input.p_required_skills) ? input.p_required_skills.map((skill) => cleanText(skill, "Skill", { max: 100 })) : [];
  const machineType = cleanText(input.p_required_machine_type, "Machine type", { required: true, max: 100 });
  const materialId = cleanText(input.p_material_id, "Material", { required: true, max: 128 });
  const materialQuantity = finiteNumber(input.p_required_material_quantity, "Material quantity", { min: Number.EPSILON });
  const plannedQuantity = integerNumber(input.p_planned_quantity, "Planned quantity", { min: 1, max: 2147483647 });
  const startAt = input.p_start_at;
  const endAt = input.p_end_at;
  const start = dateMillis(startAt, "Start time");
  const end = dateMillis(endAt, "End time");
  if (end <= start) fail("End time must be after start time.", "invalid-argument");

  const taskRef = db.collection("production_tasks").doc();
  const allocationRef = db.collection("resource_allocations").doc();
  const counterRef = db.collection("counters").doc("production_tasks");
  return db.runTransaction(async (transaction) => {
    const [employeeSnapshot, machineSnapshot, materialSnapshot, allocationSnapshot, settingsSnapshot, counterSnapshot] =
      await Promise.all([
        transaction.get(db.collection("employees").where("is_active", "==", true)),
        transaction.get(db.collection("machines").where("is_active", "==", true)),
        transaction.get(db.collection("materials").doc(materialId)),
        transaction.get(db.collection("resource_allocations").where("status", "in", [...ACTIVE_ALLOCATION_STATES])),
        transaction.get(db.collection("factory_settings").doc("main")),
        transaction.get(counterRef),
      ]);
    const employees = rows(employeeSnapshot);
    const machines = rows(machineSnapshot);
    const allocations = rows(allocationSnapshot);
    const settings = { ...DEFAULT_SETTINGS, ...(settingsSnapshot.data() || {}) };
    const material = row(materialSnapshot);
    if (!material?.is_active) fail("Selected material is currently inactive or not found.");
    let available = Number(material.quantity_on_hand) - Number(material.quantity_reserved || 0);
    const reorderBuffer = settings.reserve_reorder_stock ? Number(material.reorder_point || 0) : 0;
    const netAvailable = available - reorderBuffer;
    if (netAvailable < materialQuantity) {
      fail(`Insufficient available stock for ${material.name}. Required: ${materialQuantity} ${material.unit}, Available: ${Math.max(0, netAvailable)} ${material.unit} (Safety buffer reserved: ${reorderBuffer} ${material.unit}).`);
    }

    const employee = employees
      .filter((candidate) => candidate.is_active && candidate.is_available &&
        Number(candidate.workload_percent) <= Number(settings.max_employee_workload_percent ?? 85) &&
        (!settings.prioritize_skill_match || skills.every((skill) => (candidate.skills || []).includes(skill))) &&
        availableAllocations(allocations, "employee_id", candidate.id, start, end))
      .sort((a, b) => Number(a.workload_percent) - Number(b.workload_percent) ||
        String(a.employee_number).localeCompare(String(b.employee_number)))[0];

    if (!employee) {
      const activeCandidates = employees.filter((c) => c.is_active && c.is_available);
      if (!activeCandidates.length) fail("No active and available employees registered in the factory.");
      const overlapCandidates = activeCandidates.filter((c) => !availableAllocations(allocations, "employee_id", c.id, start, end));
      const skillCandidates = activeCandidates.filter((c) => settings.prioritize_skill_match && !skills.every((s) => (c.skills || []).includes(s)));
      const workloadCandidates = activeCandidates.filter((c) => Number(c.workload_percent) > Number(settings.max_employee_workload_percent ?? 85));
      const reasons = [];
      if (overlapCandidates.length) reasons.push(`${overlapCandidates.length} employee(s) have overlapping schedule conflicts`);
      if (skillCandidates.length) reasons.push(`${skillCandidates.length} employee(s) lack required skills [${skills.join(", ")}]`);
      if (workloadCandidates.length) reasons.push(`${workloadCandidates.length} employee(s) exceed maximum workload limit (${settings.max_employee_workload_percent ?? 85}%)`);
      fail(`Smart allocation unable to find an operator: ${reasons.join("; ") || "No operator matches the specified criteria"}.`);
    }

    const machine = machines
      .filter((candidate) => candidate.is_active && candidate.status === "available" &&
        String(candidate.machine_type).toLowerCase() === machineType.toLowerCase() &&
        (candidate.compatible_material_categories || []).some((category) =>
          String(category).toLowerCase() === String(material.category).toLowerCase()) &&
        availableAllocations(allocations, "machine_id", candidate.id, start, end))
      .sort((a, b) => String(a.machine_code).localeCompare(String(b.machine_code)))[0];

    if (!machine) {
      const activeMachines = machines.filter((c) => c.is_active);
      if (!activeMachines.length) fail("No active machines registered in the factory.");
      const typeCandidates = activeMachines.filter((c) => String(c.machine_type).toLowerCase() !== machineType.toLowerCase());
      const statusCandidates = activeMachines.filter((c) => c.status !== "available");
      const compatCandidates = activeMachines.filter((c) => !(c.compatible_material_categories || []).some((cat) => String(cat).toLowerCase() === String(material.category).toLowerCase()));
      const overlapCandidates = activeMachines.filter((c) => !availableAllocations(allocations, "machine_id", c.id, start, end));
      const reasons = [];
      if (overlapCandidates.length) reasons.push(`${overlapCandidates.length} machine(s) booked for an overlapping task`);
      if (statusCandidates.length) reasons.push(`${statusCandidates.length} machine(s) under maintenance or in-use`);
      if (compatCandidates.length) reasons.push(`${compatCandidates.length} machine(s) incompatible with ${material.category} material`);
      if (typeCandidates.length) reasons.push(`${typeCandidates.length} machine(s) do not match required type "${machineType}"`);
      fail(`Smart allocation unable to find a machine: ${reasons.join("; ") || "No machine matches requirements"}.`);
    }

    const now = new Date().toISOString();
    const taskNumber = Number(counterSnapshot.data()?.next || 1);
    const employeeReason = `Skill match verified (${skills.length ? skills.join(", ") : "General"}); Workload: ${employee.workload_percent}%; Zero schedule overlap.`;
    const machineReason = `Machine type "${machine.machine_type}" matched; Compatible with "${material.category}"; Status available; Zero schedule overlap.`;
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
      created_by: uid,
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
    transaction.update(db.collection("materials").doc(material.id), {
      quantity_reserved: Number(material.quantity_reserved || 0) + materialQuantity,
      updated_at: now,
    });
    transaction.update(db.collection("employees").doc(employee.id), { last_allocated_at: now });
    transaction.update(db.collection("machines").doc(machine.id), { last_allocated_at: now });
    if (settings.conflict_notifications) {
      const notification = db.collection("notifications").doc();
      transaction.set(notification, newNotification(
        "Task scheduled",
        `${task.title} was assigned to ${employee.first_name} ${employee.last_name} on ${machine.machine_code}. Reason: ${employeeReason}`,
        "task",
        "production_task",
        task.id,
      ));
    }
    return { task, employee, machine, reasons: { employee: employeeReason, machine: machineReason, material: materialReason } };
  });
});

export const startProductionTask = onCall(async (request) => {
  requireAdmin(request);
  const taskId = cleanText(request.data?.p_task_id, "Task ID", { required: true, max: 128 });
  const taskRef = db.collection("production_tasks").doc(taskId);
  return db.runTransaction(async (transaction) => {
    const taskSnapshot = await transaction.get(taskRef);
    const task = row(taskSnapshot);
    if (!task || task.status !== "scheduled") fail("Task is missing or is not scheduled.");
    const allocationSnapshot = await transaction.get(db.collection("resource_allocations").where("task_id", "==", taskId));
    if (allocationSnapshot.empty) fail("Production task has no resource allocation.");
    const now = new Date().toISOString();
    transaction.update(taskRef, { status: "in_progress", updated_at: now });
    transaction.update(allocationSnapshot.docs[0].ref, { status: "in_progress" });
    return { success: true };
  });
});

export const recordProduction = onCall(async (request) => {
  const uid = requireAdmin(request);
  const input = request.data || {};
  const taskId = cleanText(input.p_task_id, "Task ID", { required: true, max: 128 });
  const goodUnits = integerNumber(input.p_good_units, "Good units", { min: 0, max: 2147483647 });
  const rejectedUnits = integerNumber(input.p_rejected_units, "Rejected units", { min: 0, max: 2147483647 });
  if (goodUnits + rejectedUnits < 1) fail("Enter at least one good or rejected unit.", "invalid-argument");
  const notes = cleanText(input.p_notes || "", "Notes");
  return db.runTransaction(async (transaction) => {
    const taskRef = db.collection("production_tasks").doc(taskId);
    const taskSnapshot = await transaction.get(taskRef);
    const task = row(taskSnapshot);
    if (!task || ["completed", "cancelled"].includes(task.status)) fail("Task is not open for production records.");
    const total = goodUnits + rejectedUnits;
    if (Number(task.produced_quantity) + total > Number(task.planned_quantity)) {
      fail("Recorded units cannot exceed the planned quantity.");
    }
    const allocationSnapshot = await transaction.get(db.collection("resource_allocations").where("task_id", "==", taskId));
    const allocation = allocationSnapshot.empty ? null : row(allocationSnapshot.docs[0]);
    if (!allocation) fail("Production task has no resource allocation.");
    const materialRef = db.collection("materials").doc(allocation.material_id);
    const materialSnapshot = await transaction.get(materialRef);
    const material = row(materialSnapshot);
    if (!material) fail("Allocated material no longer exists.");

    const produced = Number(task.produced_quantity) + total;
    const consumed = Math.round(Number(allocation.reserved_material_quantity) * produced / Number(task.planned_quantity) * 1000) / 1000;
    const delta = consumed - Number(allocation.consumed_material_quantity || 0);
    const completed = produced >= Number(task.planned_quantity);
    const now = new Date().toISOString();
    const recordRef = db.collection("production_records").doc();
    transaction.set(recordRef, {
      id: recordRef.id,
      task_id: taskId,
      good_units: goodUnits,
      rejected_units: rejectedUnits,
      notes,
      recorded_by: uid,
      recorded_at: now,
    });
    transaction.update(materialRef, {
      quantity_on_hand: Number(material.quantity_on_hand) - delta,
      quantity_reserved: Number(material.quantity_reserved) - delta,
      updated_at: now,
    });
    transaction.update(allocationSnapshot.docs[0].ref, {
      consumed_material_quantity: consumed,
      status: completed ? "completed" : "in_progress",
    });
    transaction.update(taskRef, {
      produced_quantity: produced,
      status: completed ? "completed" : "in_progress",
      updated_at: now,
    });
    return { task: { ...task, produced_quantity: produced, status: completed ? "completed" : "in_progress" }, recorded_units: total };
  });
});

export const cancelProductionTask = onCall(async (request) => {
  requireAdmin(request);
  const taskId = cleanText(request.data?.p_task_id, "Task ID", { required: true, max: 128 });
  return db.runTransaction(async (transaction) => {
    const taskRef = db.collection("production_tasks").doc(taskId);
    const taskSnapshot = await transaction.get(taskRef);
    const task = row(taskSnapshot);
    if (!task) fail("Task not found.");
    if (task.status === "completed") fail("Completed tasks cannot be cancelled.");
    const allocationSnapshot = await transaction.get(db.collection("resource_allocations").where("task_id", "==", taskId));
    const allocation = allocationSnapshot.empty ? null : row(allocationSnapshot.docs[0]);
    let materialSnapshot = null;
    if (allocation && ACTIVE_ALLOCATION_STATES.has(allocation.status)) {
      materialSnapshot = await transaction.get(db.collection("materials").doc(allocation.material_id));
      if (!materialSnapshot.exists) fail("Allocated material no longer exists.");
    }
    const now = new Date().toISOString();
    if (allocation && ACTIVE_ALLOCATION_STATES.has(allocation.status)) {
      const unconsumed = Number(allocation.reserved_material_quantity) - Number(allocation.consumed_material_quantity || 0);
      transaction.update(materialSnapshot.ref, {
        quantity_reserved: Number(materialSnapshot.data().quantity_reserved) - unconsumed,
        updated_at: now,
      });
      transaction.update(allocationSnapshot.docs[0].ref, { status: "cancelled" });
    }
    transaction.update(taskRef, { status: "cancelled", updated_at: now });
    const notification = db.collection("notifications").doc();
    transaction.set(notification, newNotification("Task cancelled", `${task.title} was cancelled.`, "task", "production_task", taskId));
    return { success: true };
  });
});

export const markNotificationRead = onCall(async (request) => {
  requireAdmin(request);
  const notificationId = cleanText(request.data?.p_notification_id, "Notification ID", { required: true, max: 128 });
  const reference = db.collection("notifications").doc(notificationId);
  const snapshot = await reference.get();
  if (!snapshot.exists) fail("Notification not found.");
  await reference.update({ is_read: true });
  return { success: true };
});

export const updateProductionTask = onCall(async (request) => {
  requireAdmin(request);
  const input = request.data || {};
  const taskId = cleanText(input.task_id, "Task ID", { required: true, max: 128 });
  const updates = {
    title: cleanText(input.title, "Task title", { required: true, max: 200 }),
    description: cleanText(input.description || "", "Description"),
    priority: input.priority,
    planned_quantity: integerNumber(input.planned_quantity, "Planned quantity", { min: 1, max: 2147483647 }),
    updated_at: new Date().toISOString(),
  };
  if (!PRIORITIES.has(updates.priority)) fail("Invalid priority.", "invalid-argument");
  const taskRef = db.collection("production_tasks").doc(taskId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(taskRef);
    const task = row(snapshot);
    if (!task || ["completed", "cancelled"].includes(task.status)) fail("Task cannot be edited.");
    if (updates.planned_quantity < Number(task.produced_quantity)) {
      fail("Planned quantity cannot be less than units already produced.", "invalid-argument");
    }
    transaction.update(taskRef, updates);
  });
  return { success: true };
});

export const saveResource = onCall(async (request) => {
  requireAdmin(request);
  const { collection: name, id, payload } = request.data || {};
  if (!RESOURCE_COLLECTIONS.has(name) || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("Invalid resource data.", "invalid-argument");
  }
  const allowed = {
    employees: new Set(["employee_number", "first_name", "last_name", "email", "job_title", "skills", "shift_name", "workload_percent", "is_available", "is_active"]),
    machines: new Set(["machine_code", "name", "machine_type", "location", "compatible_material_categories", "status", "is_active"]),
    materials: new Set(["sku", "name", "category", "unit", "quantity_on_hand", "reorder_point", "is_active"]),
  }[name];
  if (Object.keys(payload).some((key) => !allowed.has(key))) fail("Resource contains unsupported fields.", "invalid-argument");
  const values = { ...payload };
  const requiredFields = {
    employees: ["employee_number", "first_name", "last_name", "shift_name"],
    machines: ["machine_code", "name", "machine_type"],
    materials: ["sku", "name", "category", "unit"],
  }[name];
  for (const field of requiredFields) values[field] = cleanText(values[field], field, { required: true, max: 200 });
  if (name === "employees") {
    values.email = values.email === null || values.email === undefined ? null :
      cleanText(values.email, "Email", { max: 320 });
    values.job_title = cleanText(values.job_title || "", "Job title", { max: 200 });
    values.skills = Array.isArray(values.skills) ? values.skills.map((skill) => cleanText(skill, "Skill", { max: 100 })) : [];
    values.workload_percent = finiteNumber(values.workload_percent ?? 0, "Workload", { min: 0, max: 100 });
    values.is_available = Boolean(values.is_available);
    values.is_active = Boolean(values.is_active);
  }
  if (name === "machines") {
    values.location = cleanText(values.location || "", "Location", { max: 200 });
    values.compatible_material_categories = Array.isArray(values.compatible_material_categories) ?
      values.compatible_material_categories.map((category) => cleanText(category, "Material category", { max: 100 })) : [];
    if (!["available", "in_use", "maintenance", "inactive"].includes(values.status)) fail("Invalid machine status.", "invalid-argument");
    values.is_active = Boolean(values.is_active);
  }
  if (name === "materials") {
    values.quantity_on_hand = finiteNumber(values.quantity_on_hand ?? 0, "Quantity on hand", { min: 0 });
    values.reorder_point = finiteNumber(values.reorder_point ?? 0, "Reorder point", { min: 0 });
    values.is_active = Boolean(values.is_active);
  }
  const collectionRef = db.collection(name);
  const documentRef = id ? collectionRef.doc(cleanText(id, "Resource ID", { required: true, max: 128 })) : collectionRef.doc();
  const newUniqueValue = values[UNIQUE_FIELDS[name]];
  const uniqueKey = (value) => createHash("sha256").update(`${name}:${value}`).digest("hex");
  const newUniqueRef = db.collection("resource_keys").doc(uniqueKey(newUniqueValue));
  await db.runTransaction(async (transaction) => {
    const uniqueField = UNIQUE_FIELDS[name];
    const [snapshot, duplicateSnapshot, uniqueSnapshot] = await Promise.all([
      transaction.get(documentRef),
      transaction.get(collectionRef.where(uniqueField, "==", newUniqueValue)),
      transaction.get(newUniqueRef),
    ]);
    const existing = row(snapshot);
    if (id && !existing) fail("Resource not found.");
    const duplicate = duplicateSnapshot.docs.some((item) => item.id !== id);
    if (duplicate || (uniqueSnapshot.exists && uniqueSnapshot.get("resource_id") !== documentRef.id)) {
      fail(`${uniqueField} must be unique.`, "already-exists");
    }
    let oldUniqueRef = null;
    let oldUniqueSnapshot = null;
    if (existing && existing[uniqueField] !== newUniqueValue) {
      oldUniqueRef = db.collection("resource_keys").doc(uniqueKey(existing[uniqueField]));
      oldUniqueSnapshot = await transaction.get(oldUniqueRef);
    }
    if (name === "materials" && existing && values.quantity_on_hand < Number(existing.quantity_reserved || 0)) {
      fail("Quantity on hand cannot be less than reserved stock.");
    }
    const now = new Date().toISOString();
    const stored = {
      ...values,
      id: documentRef.id,
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    if (name === "materials") stored.quantity_reserved = Number(existing?.quantity_reserved || 0);
    transaction.set(documentRef, stored);
    transaction.set(newUniqueRef, { collection: name, value: newUniqueValue, resource_id: documentRef.id });
    if (oldUniqueRef && oldUniqueSnapshot?.exists && oldUniqueSnapshot.get("resource_id") === documentRef.id) {
      transaction.delete(oldUniqueRef);
    }
  });
  return { id: documentRef.id };
});

export const deleteResource = onCall(async (request) => {
  requireAdmin(request);
  const { collection: name, id } = request.data || {};
  if (!RESOURCE_COLLECTIONS.has(name)) fail("Invalid resource collection.", "invalid-argument");
  const reference = db.collection(name).doc(cleanText(id, "Resource ID", { required: true, max: 128 }));
  await db.runTransaction(async (transaction) => {
    const field = name === "employees" ? "employee_id" : name === "machines" ? "machine_id" : "material_id";
    const allocationQuery = db.collection("resource_allocations").where(field, "==", id);
    const reads = [
      transaction.get(reference),
      transaction.get(allocationQuery),
    ];
    if (name === "materials") reads.push(transaction.get(db.collection("production_tasks").where("material_id", "==", id)));
    const [snapshot, allocationSnapshot, taskSnapshot] = await Promise.all(reads);
    if (!snapshot.exists) fail("Resource not found.");
    if (!allocationSnapshot.empty || (taskSnapshot && !taskSnapshot.empty)) {
      fail("This resource is linked to production history and cannot be deleted.");
    }
    const uniqueField = UNIQUE_FIELDS[name];
    const uniqueKey = createHash("sha256").update(`${name}:${snapshot.get(uniqueField)}`).digest("hex");
    const uniqueRef = db.collection("resource_keys").doc(uniqueKey);
    const uniqueSnapshot = await transaction.get(uniqueRef);
    transaction.delete(reference);
    if (uniqueSnapshot.exists && uniqueSnapshot.get("resource_id") === id) transaction.delete(uniqueRef);
  });
  return { success: true };
});

export const saveFactorySettings = onCall(async (request) => {
  requireAdmin(request);
  const input = request.data || {};
  const { id: _id, ...payload } = input;
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS).filter((key) => key !== "id"));
  if (Object.keys(payload).some((key) => !allowed.has(key))) fail("Settings contain unsupported fields.", "invalid-argument");
  const settings = {
    ...payload,
    workspace_name: cleanText(payload.workspace_name, "Workspace name", { required: true, max: 200 }),
    plant_location: cleanText(payload.plant_location || "", "Plant location", { max: 200 }),
    time_zone: cleanText(payload.time_zone, "Time zone", { required: true, max: 100 }),
    max_employee_workload_percent: finiteNumber(payload.max_employee_workload_percent, "Maximum workload", { min: 1, max: 100 }),
    updated_at: new Date().toISOString(),
  };
  for (const key of ["prioritize_skill_match", "reserve_reorder_stock", "conflict_notifications", "low_stock_notifications", "daily_shift_summary"]) {
    if (typeof payload[key] !== "boolean") fail(`${key} must be a boolean.`, "invalid-argument");
  }
  for (const key of ["shift_a_start", "shift_a_end", "shift_b_start", "shift_b_end"]) {
    if (!/^\d{2}:\d{2}$/.test(payload[key] || "")) fail(`${key} must use HH:MM.`, "invalid-argument");
  }
  const reference = db.collection("factory_settings").doc("main");
  await reference.set({ ...settings, id: true }, { merge: true });
  return { success: true };
});

export const notifyMaterialReorder = onDocumentWritten("materials/{materialId}", async (event) => {
  const before = event.data?.before.exists ? event.data.before.data() : null;
  const after = event.data?.after.exists ? event.data.after.data() : null;
  if (!after) return;
  const settingsSnapshot = await db.collection("factory_settings").doc("main").get();
  const settings = { ...DEFAULT_SETTINGS, ...(settingsSnapshot.data() || {}) };
  if (!settings.low_stock_notifications) return;
  const available = Number(after.quantity_on_hand) - Number(after.quantity_reserved || 0);
  const previousAvailable = before ? Number(before.quantity_on_hand) - Number(before.quantity_reserved || 0) :
    Number(after.reorder_point) + 1;
  if (available <= Number(after.reorder_point) && previousAvailable > Number(after.reorder_point)) {
    const notificationId = `${event.params.materialId}_${event.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    await db.collection("notifications").doc(notificationId).set(newNotification(
      "Material at reorder point",
      `${after.name} has ${available} ${after.unit} available; reorder point is ${after.reorder_point} ${after.unit}.`,
      "inventory",
      "material",
      event.params.materialId,
    ));
  }
});

export const setFactoryAdmin = onCall(async (request) => {
  const callerUid = requireAdmin(request);
  const { uid, enabled } = request.data || {};
  if (typeof enabled !== "boolean" || typeof uid !== "string" || !uid.trim()) {
    fail("A user ID and boolean enabled value are required.", "invalid-argument");
  }
  const user = await auth.getUser(uid);
  const claims = { ...user.customClaims };
  if (enabled) claims.admin = true;
  else delete claims.admin;
  if (!enabled && callerUid === uid) fail("You cannot revoke your own administrator role.");
  await auth.setCustomUserClaims(uid, claims);
  await db.collection("profiles").doc(uid).set({
    id: uid,
    email: user.email || "",
    display_name: user.displayName || "",
    role: enabled ? "admin" : "operator",
    updated_at: new Date().toISOString(),
  }, { merge: true });
  return { success: true };
});
