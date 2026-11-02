# Smart Factory Resource Allocation System (SRAS)

> **College Level Project** — An intelligent manufacturing operations platform that plans production runs and autonomously allocates resources (technicians, machines, and raw inventory) using multi-constraint heuristic optimization and zero-conflict ACID transactions.

---

## 📌 Project Overview
In modern manufacturing plants, manual task scheduling on spreadsheets often leads to double-booked machinery, operator overburden, and unexpected raw material stockouts. 

**SRAS (Smart Factory Resource Allocation System)** solves this by introducing an automated resource intelligence engine. When a factory manager schedules a task, SRAS evaluates employee skill certifications, machine compatibility, time-slot availability, and stock levels to compute the optimal, conflict-free allocation in real time.

---

## 🚀 Key Features

### 1. Multi-Constraint Smart Allocation
- **Skill Certification Matching:** Only assigns tasks to operators certified in the required skills.
- **Machine Type & Material Compatibility:** Validates machine specifications against raw material categories (e.g. Stainless Steel vs. Aluminum).
- **Safety Reorder Buffer Protection:** Protects critical inventory reserves during material reservations.
- **Operator Workload Balancing:** Optimizes shop-floor fatigue by picking qualified operators with the lowest current workload.
- **Temporal Overlap Prevention:** Strictly blocks concurrent double-booking of any operator or machine.
- **Transparent Rationale & Diagnosis:** If an allocation succeeds, the system records the exact decision rationale; if it fails, it reports the exact bottleneck (e.g. schedule overlap, lack of skill, or low stock).

### 2. Live Operations Dashboard
- **Production Pulse:** Visual bar graph comparing planned output against actual finished units.
- **Capacity KPIs:** Real-time metrics for open tasks, available operators, ready machines, and healthy inventory.
- **Audit Notifications:** Centralized feed for allocation events, reorder threshold alerts, and task cancellations.

### 3. Production Lifecycle Management
- **Task Lifecycle:** Schedule $\rightarrow$ Start $\rightarrow$ Record Output $\rightarrow$ Complete / Cancel.
- **Quality & Yield Tracking:** Logs good finished units versus rejected scrap to calculate first-pass yield rate %.
- **Safe Material Release:** Cancelling an open task automatically restores unconsumed reserved stock back to free inventory.

### 4. Interactive Schedule & Timeline
- **Gantt Chart Representation:** Horizontal time-block visualization showing concurrent tasks across the factory floor.
- **Visual Conflict Verification:** Immediate visual proof that no operator or machine has overlapping commitments.

### 5. Multi-Tier Security & RBAC
- **Firebase Authentication:** Secure email/password login.
- **Role Enforcement:** Primary Factory Manager/Admin role with view-only Operator role.
- **Anti-Privilege Escalation:** Firestore rules prevent non-admin users from elevating their role to `admin`.
- **Atomic Concurrency:** All reservations execute in transactional Cloud Functions or atomic Firestore transactions to eliminate race conditions.

### 6. Built-in College Demo Dataset
- One-click **"Seed College Demo Data"** button in Settings (and CLI script) safely initializes 4 skilled operators, 4 specialized machines, 5 raw material SKUs, and active production runs for viva evaluations.

---

## 🏛️ System Architecture

```
+-------------------------------------------------------------------------+
|                         FRONTEND CLIENT TIER                            |
|  React 19 + Vite 7 + Tailwind CSS v4 + Lucide Icons + Responsive SPA    |
|  - Real-Time Smart Allocation Simulator & Conflict Inspector            |
|  - Visual Gantt Timeline, Production Pulse & Analytics Dashboard        |
+-----------------------------------+-------------------------------------+
                                    |
                    HTTPS / Firebase SDK v13 (Modular)
                                    |
+-----------------------------------v-------------------------------------+
|                      APPLICATION / LOGIC TIER                           |
|  Cloud Functions for Firebase (v2, Node.js 20)                          |
|  - Input Validation, Workload Minimization, and Conflict Checking       |
|  - Dual-Mode Resilience (Cloud Functions v2 + Client Transaction Fallback)|
+-----------------------------------+-------------------------------------+
                                    |
                    Google Cloud Firestore (Enterprise Mode)
                                    |
+-----------------------------------v-------------------------------------+
|                          DATA & SECURITY TIER                           |
|  Cloud Firestore + Firebase Auth (Email/Password & Custom Claims)       |
|  - Least-Privilege Security Rules (Anti-Escalation Profile Protection)  |
|  - ACID Transactions (runTransaction) with Zero Race Conditions         |
+-------------------------------------------------------------------------+
```

---

## 📂 Cloud Firestore Collections & Data Model

| Collection | Key Fields | Purpose |
| :--- | :--- | :--- |
| `profiles` | `id`, `email`, `display_name`, `role`, `updated_at` | User authorization & RBAC |
| `employees` | `employee_number`, `first_name`, `last_name`, `skills`, `shift_name`, `workload_percent`, `is_available`, `is_active` | Factory workforce records |
| `machines` | `machine_code`, `name`, `machine_type`, `location`, `compatible_material_categories`, `status`, `is_active` | Equipment inventory & status |
| `materials` | `sku`, `name`, `category`, `unit`, `quantity_on_hand`, `quantity_reserved`, `reorder_point`, `is_active` | Raw materials & safety buffers |
| `production_tasks`| `task_number`, `title`, `priority`, `status`, `required_skills`, `required_machine_type`, `planned_quantity`, `produced_quantity`, `start_at`, `end_at` | Production job orders |
| `resource_allocations` | `task_id`, `employee_id`, `machine_id`, `material_id`, `start_at`, `end_at`, `reserved_material_quantity`, `allocation_reasons` | Active & historical resource commitments |
| `production_records` | `task_id`, `good_units`, `rejected_units`, `notes`, `recorded_by`, `recorded_at` | Output logs & QA audit trail |
| `factory_settings` | `workspace_name`, `plant_location`, `time_zone`, `max_employee_workload_percent`, `prioritize_skill_match`, `reserve_reorder_stock`, `shifts` | Plant rules & thresholds |
| `notifications` | `title`, `message`, `category`, `entity_type`, `entity_id`, `is_read`, `created_at` | Operational notices & warnings |

---

## 🧠 Smart Allocation Algorithm (Heuristic Decision Rules)

1. **Feasibility Filtering:**
   - Operator: $\text{Active} \land \text{Available} \land (\text{Skills} \supseteq \text{RequiredSkills})$
   - Machine: $\text{Active} \land (\text{Status} = \text{"available"}) \land (\text{Type} = \text{RequiredType}) \land (\text{Category} \in \text{CompatibleCategories})$
   - Material: $(Q_{\text{on\_hand}} - Q_{\text{reserved}}) - (\text{ReserveBuffer} \times Q_{\text{reorder}}) \ge Q_{\text{required}}$

2. **Temporal Overlap Prevention (Zero Double-Booking):**
   - For candidate resource $R$ and interval $[T_s, T_e]$:
   - $\forall A \in \text{Allocations}(R) \text{ where } \text{Status}(A) \in \{\text{"reserved"}, \text{"in\_progress}\}\!: (T_s \ge \text{End}(A)) \lor (T_e \le \text{Start}(A))$

3. **Workload Minimization (Load Balancing):**
   - Candidate operators are ranked by ascending `workload_percent`:
   - $e^* = \arg\min_{e \in \text{Feasible}} \text{WorkloadPercent}(e)$ subject to $\text{WorkloadPercent}(e) \le W_{\max}$ (default: 85%).

4. **Atomic Reservation:**
   - Task, allocation, and inventory stock reservation are committed inside a single atomic database transaction.

---

## 🛠️ Local Setup & Run Guide

### Prerequisites
- [Node.js](https://nodejs.org/) (version 20 or higher)
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)

### Step 1: Clone and Install Dependencies
```powershell
# From project root
npm --prefix frontend install
```

### Step 2: Environment Configuration
Copy `frontend/.env.example` to `frontend/.env` and verify your Firebase project credentials:
```env
VITE_FIREBASE_API_KEY=""
VITE_FIREBASE_AUTH_DOMAIN=""
VITE_FIREBASE_PROJECT_ID=""
VITE_FIREBASE_APP_ID=""
VITE_FIREBASE_STORAGE_BUCKET=""
VITE_FIREBASE_MESSAGING_SENDER_ID=""
VITE_FIREBASE_FUNCTIONS_REGION=""
```

### Step 3: Run the Development Server
```powershell
npm run dev
# Or directly:
npm --prefix frontend run dev
```
Open the printed local URL (`http://localhost:5173`) in your web browser.

### Step 4: Provision Admin Account (First-Time Setup)
To grant an account administrator access:
```powershell
cd backend/firebase/scripts
npm install
$env:FIREBASE_PROJECT_ID = ""
$env:FIREBASE_ADMIN_EMAIL = ""
npm run set-admin
```

---

## 🚢 Firebase Deployment Steps

```powershell
# 1. Login to Firebase CLI
firebase login

# 2. Select your Firebase project
firebase use sfras-1b538

# 3. Deploy Firestore Security Rules
firebase deploy --only firestore:rules

# 4. Build Frontend Bundle
npm --prefix frontend run build

# 5. Deploy Hosting (and Functions if on Blaze plan)
firebase deploy --only hosting
# Or deploy everything:
firebase deploy
```

---

## 🎓 College Viva / Demo Walkthrough Flow

When presenting this project to a professor or evaluation panel:
1. **Sign-In & RBAC Demonstration:**
   - Log in with the administrator email. Show that the role is verified from Firestore.
   - Show how standard operator users are restricted to view-only mode, and client-side privilege escalation is blocked in `firestore.rules`.
2. **One-Click Demo Data Loading:**
   - Go to **Settings** $\rightarrow$ Click **"Seed College Demo Data"**.
   - Show that 4 qualified operators, 4 specialized machines, 5 materials, and active runs appear instantly across all screens.
3. **Smart Allocation Simulation:**
   - Click **"+ New production task"**.
   - As you select Machine Type "CNC", required skills "CNC", and Material "316L Stainless Steel", point out the **Live Smart Allocation Preview Box**.
   - Show how it recommends the optimal operator (Rajesh Sharma) based on lowest workload (45%) and zero conflict.
   - Adjust the time slot to overlap with an existing task to demonstrate real-time conflict detection!
4. **Schedule & Timeline Verification:**
   - Open **Schedule** $\rightarrow$ Inspect the visual **Gantt Timeline**.
   - Point out that tasks run in distinct, non-overlapping windows.
   - Click **"Match Details"** to show the transparent mathematical audit rationale stored with the allocation.
5. **Production Execution & Quality Tracking:**
   - Open **Production** $\rightarrow$ Click **"+"** to record output (e.g. 20 good units, 1 rejected unit).
   - Show how good and scrap units update the **Yield %** in Analytics.
   - Cancel a task to demonstrate the automatic release of reserved material stock back to inventory.

---

## 📄 Additional Documentation
- [Comprehensive College Project Report (`COLLEGE_DOCUMENTATION.md`)](./COLLEGE_DOCUMENTATION.md)
- [Firebase Setup & Deployment Guide (`frontend/public/FIREBASE_SETUP.md`)](./frontend/public/FIREBASE_SETUP.md)

---
*Created for Smart Factory Resource Allocation System (SRAS).*
