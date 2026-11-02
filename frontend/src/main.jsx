import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, Bell,
  Boxes, CalendarDays, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, Cpu, Database, Factory, FileBarChart2, Filter, Gauge, HardHat, Info,
  LayoutDashboard, Layers, LogOut, Menu, Moon, MoreHorizontal, Package, Play, Plus,
  RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Sun, Users, Wrench, X, Zap,
} from "lucide-react";
import { createFirebaseClient, formatFirebaseError, hasFirebaseConfiguration } from "./firebase-client.js";
import "./styles.css";

const NAV_GROUPS = [
  { label: "WORKSPACE", items: [
    { id: "Overview", label: "Overview", icon: LayoutDashboard },
    { id: "Production", label: "Production", icon: Factory },
    { id: "Resources", label: "Resources", icon: Boxes },
    { id: "Schedule", label: "Schedule", icon: CalendarDays },
    { id: "Analytics", label: "Analytics", icon: FileBarChart2 },
  ] },
  { label: "MANAGE", items: [
    { id: "Team", label: "Team", icon: Users },
    { id: "Settings", label: "Settings", icon: Settings2 },
  ] },
];

const RESOURCE_FIELDS = {
  employees: [
    ["employee_number", "Employee ID", "text", true],
    ["first_name", "First name", "text", true],
    ["last_name", "Last name", "text", true],
    ["email", "Email", "email", false],
    ["job_title", "Job title", "text", false],
    ["skills", "Skills · comma separated", "text", false],
    ["shift_name", "Shift", "text", true],
    ["workload_percent", "Workload (%)", "number", true],
    ["is_available", "Available for work", "checkbox", false],
    ["is_active", "Active employee", "checkbox", false],
  ],
  machines: [
    ["machine_code", "Machine code", "text", true],
    ["name", "Machine name", "text", true],
    ["machine_type", "Machine type", "text", true],
    ["location", "Location", "text", false],
    ["compatible_material_categories", "Compatible material categories · comma separated", "text", false],
    ["status", "Status", "select:available,in_use,maintenance,inactive", true],
    ["is_active", "Active machine", "checkbox", false],
  ],
  materials: [
    ["sku", "SKU", "text", true],
    ["name", "Material name", "text", true],
    ["category", "Category", "text", true],
    ["unit", "Unit", "text", true],
    ["quantity_on_hand", "Quantity on hand", "number", true],
    ["reorder_point", "Reorder point", "number", true],
    ["is_active", "Active material", "checkbox", false],
  ],
};

const PAGE_COPY = {
  Overview: ["Good morning", "Your factory resource intelligence at a glance."],
  Production: ["Production", "Plan, schedule, and execute production tasks with smart resource matching."],
  Resources: ["Resources", "Workforce, machines, and materials catalog with live availability."],
  Schedule: ["Schedule", "Conflict-free timeline and allocation reservations."],
  Analytics: ["Analytics", "Real production metrics, yield rates, and utilization analytics."],
  Team: ["Your team", "Skills matrix and operator workload profiles."],
  Settings: ["Settings", "Factory workspace preferences, allocation rules, and demo tools."],
  Notifications: ["Notifications", "Operational alerts, stock warnings, and allocation logs."],
};

function initials(profile) {
  return (profile?.display_name || profile?.email || "Admin")
    .split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function nameOf(employee) {
  return [employee?.first_name, employee?.last_name].filter(Boolean).join(" ") || "Unassigned";
}

function moneyNumber(value, digits = 2) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(Number(value || 0));
}

function dateTime(value) {
  return value ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

function localInputDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function ErrorBanner({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="error-banner">
      <AlertCircle size={17} />
      <span>{message}</span>
      {onClose && <button onClick={onClose} aria-label="Dismiss"><X size={15} /></button>}
    </div>
  );
}

function Button({ children, variant = "secondary", className = "", ...props }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

function Field({ label, className = "", ...props }) {
  return <label className={`field ${className}`}><span>{label}</span><input {...props} /></label>;
}

function Panel({ children, className = "", ...props }) {
  return <section className={`panel ${className}`} {...props}>{children}</section>;
}

function EmptyState({ icon: Icon = Boxes, title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={22} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

function Modal({ title, description, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-card ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-heading">
          <div>
            <span className="eyebrow"><Zap size={13} /> SMART FACTORY SYSTEM</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function App() {
  const [client, setClient] = useState(null);
  const clientRef = useRef(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [page, setPage] = useState("Overview");
  const [theme, setTheme] = useState(() => localStorage.getItem("forge-theme") || "light");
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState("");
  const [resourceTab, setResourceTab] = useState("employees");
  const [taskModal, setTaskModal] = useState(false);
  const [explainerModal, setExplainerModal] = useState(false);
  const [allocationDetailModal, setAllocationDetailModal] = useState(null);
  const [dataModal, setDataModal] = useState(null);
  const [data, setData] = useState({
    employees: [],
    machines: [],
    materials: [],
    tasks: [],
    allocations: [],
    records: [],
    notifications: [],
    settings: null,
  });

  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("forge-theme", theme);
  }, [theme]);

  const flash = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 4000);
  }, []);

  const loadData = useCallback(async (activeClient = clientRef.current) => {
    if (!activeClient) return;
    setDataLoading(true);
    setError("");
    const results = await Promise.all([
      activeClient.from("employees").select("*").order("employee_number"),
      activeClient.from("machines").select("*").order("machine_code"),
      activeClient.from("materials").select("*").order("name"),
      activeClient.from("production_tasks").select("*").order("created_at", { ascending: false }),
      activeClient.from("resource_allocations").select("*").order("start_at"),
      activeClient.from("production_records").select("*").order("recorded_at", { ascending: false }),
      activeClient.from("notifications").select("*").order("created_at", { ascending: false }).limit(100),
      activeClient.from("factory_settings").select("*").eq("id", true).maybeSingle(),
    ]);

    const failed = results.find((result) => result.error);
    if (failed) {
      setError(failed.error.message);
      setDataLoading(false);
      return;
    }

    setData({
      employees: results[0].data || [],
      machines: results[1].data || [],
      materials: results[2].data || [],
      tasks: results[3].data || [],
      allocations: results[4].data || [],
      records: results[5].data || [],
      notifications: results[6].data || [],
      settings: results[7].data,
    });
    setDataLoading(false);
  }, []);

  const finishSession = useCallback(async (activeSession, activeClient) => {
    if (!activeSession?.user) {
      setSession(null);
      setProfile(null);
      setData({ employees: [], machines: [], materials: [], tasks: [], allocations: [], records: [], notifications: [], settings: null });
      return;
    }
    setSession(activeSession);

    // Force refresh ID token from Firebase to pick up newly assigned custom claims (admin: true)
    let tokenResult = null;
    try {
      tokenResult = await activeSession.user._rawUser?.getIdTokenResult(true);
    } catch (_) {}

    const { data: profileData } = await activeClient.from("profiles")
      .select("id,email,display_name,role").eq("id", activeSession.user.id).single();

    const role = (tokenResult?.claims?.admin === true || profileData?.role === "admin") ? "admin" : (profileData?.role || "operator");

    setProfile({
      id: activeSession.user.id,
      email: activeSession.user.email,
      display_name: profileData?.display_name || activeSession.user.displayName || activeSession.user.email?.split("@")[0] || "Operator",
      role,
    });
    await loadData(activeClient);
  }, [loadData]);

  useEffect(() => {
    let mounted = true;
    if (!hasFirebaseConfiguration()) {
      setError("Set the Firebase web app values in frontend/.env before starting the app.");
      setLoading(false);
      return undefined;
    }
    let firebase;
    try {
      firebase = createFirebaseClient();
      clientRef.current = firebase;
      setClient(firebase);
    } catch (clientError) {
      setError(clientError.message);
      setLoading(false);
      return undefined;
    }

    const { data: listener } = firebase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setSession(null);
        setProfile(null);
      }
    });

    firebase.auth.getSession().then(({ data: authData, error: authError }) => {
      if (!mounted) return;
      if (authError) setError(authError.message);
      if (authData?.session) {
        finishSession(authData.session, firebase).catch((loadError) => setError(loadError.message));
      }
      setLoading(false);
    }).catch((authError) => {
      if (mounted) {
        setError(authError.message);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [finishSession]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const allocationsByTask = useMemo(() => new Map(data.allocations.map((item) => [item.task_id, item])), [data.allocations]);
  const getEmployee = (id) => data.employees.find((item) => item.id === id);
  const getMachine = (id) => data.machines.find((item) => item.id === id);
  const getMaterial = (id) => data.materials.find((item) => item.id === id);

  const navigate = (next) => {
    setPage(next);
    setSearch("");
    setMobileNav(false);
    window.history.pushState({ page: next }, "", next === "Overview" ? "#overview" : `#${next.toLowerCase()}`);
  };

  useEffect(() => {
    const onPop = (event) => setPage(event.state?.page || "Overview");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const signIn = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const { data: authData, error: authError } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authError) {
      setError(formatFirebaseError(authError));
    } else {
      setPassword("");
      try {
        await finishSession(authData.session, client);
      } catch (loadError) {
        setError(formatFirebaseError(loadError));
      }
    }
    setBusy(false);
  };

  const resetPassword = async () => {
    if (!email.trim()) {
      setError("Please enter your registered account email first.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: resetError } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}${window.location.pathname}`,
    });
    if (resetError) {
      setError(formatFirebaseError(resetError));
    } else {
      flash("Password reset instructions sent to your email.");
    }
    setBusy(false);
  };

  const signOut = async () => {
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) setError(formatFirebaseError(signOutError));
    else {
      setSession(null);
      setProfile(null);
    }
  };

  const openTask = () => {
    if (!isAdmin) {
      setError("Only Factory Managers/Administrators can schedule new production tasks.");
      return;
    }
    if (!data.materials.some((material) => material.is_active)) {
      setError("Please add at least one active raw material in Resources before scheduling a production task.");
      return;
    }
    setError("");
    setTaskModal(true);
  };

  const taskFormSubmit = async (event) => {
    event.preventDefault();
    if (!isAdmin) {
      setError("Action restricted to administrators.");
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const start = new Date(form.get("start_at"));
      const end = new Date(form.get("end_at"));
      if (end <= start) throw new Error("End time must be after start time.");

      const { data: allocated, error: taskError } = await client.rpc("create_production_task", {
        p_title: form.get("title").trim(),
        p_description: form.get("description").trim(),
        p_priority: form.get("priority"),
        p_required_skills: form.get("required_skills").split(",").map((skill) => skill.trim()).filter(Boolean),
        p_required_machine_type: form.get("machine_type").trim(),
        p_material_id: form.get("material_id"),
        p_required_material_quantity: Number(form.get("required_material_quantity")),
        p_planned_quantity: Number(form.get("planned_quantity")),
        p_start_at: start.toISOString(),
        end_at: end.toISOString(),
        p_end_at: end.toISOString(),
      });

      if (taskError) throw taskError;
      setTaskModal(false);
      await loadData();
      flash(`Task #${allocated.task.task_number} smartly allocated to ${nameOf(allocated.employee)} & Machine ${allocated.machine.machine_code}!`);
    } catch (taskError) {
      setError(formatFirebaseError(taskError));
    } finally {
      setBusy(false);
    }
  };

  const openResource = (type, row = null) => {
    if (!isAdmin) {
      setError("Adding or modifying factory resources requires Factory Administrator permissions.");
      return;
    }
    setError("");
    setDataModal({ mode: "resource", type, row });
  };

  const resourceSubmit = async (event) => {
    event.preventDefault();
    if (!isAdmin) {
      setError("Admin access required.");
      return;
    }
    const modal = dataModal;
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    if (modal.type === "employees") {
      payload.skills = payload.skills ? payload.skills.split(",").map((value) => value.trim()).filter(Boolean) : [];
      payload.workload_percent = Number(payload.workload_percent);
      payload.is_available = form.has("is_available");
      payload.is_active = form.has("is_active");
    } else if (modal.type === "machines") {
      payload.compatible_material_categories = payload.compatible_material_categories ? payload.compatible_material_categories.split(",").map((value) => value.trim()).filter(Boolean) : [];
      payload.is_active = form.has("is_active");
    } else {
      payload.quantity_on_hand = Number(payload.quantity_on_hand);
      payload.reorder_point = Number(payload.reorder_point);
      payload.is_active = form.has("is_active");
    }
    Object.keys(payload).forEach((key) => {
      if (payload[key] === "") payload[key] = null;
    });

    setBusy(true);
    try {
      const table = modal.type;
      const result = modal.row
        ? await client.from(table).update(payload).eq("id", modal.row.id)
        : await client.from(table).insert(payload);
      if (result.error) throw result.error;
      setDataModal(null);
      await loadData();
      flash(`${modal.row ? "Updated" : "Created"} ${modal.type.slice(0, -1)} in Firestore.`);
    } catch (saveError) {
      setError(formatFirebaseError(saveError));
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteResource = async (type, row) => {
    if (!isAdmin) {
      setError("Resource deletion requires administrator permissions.");
      return;
    }
    if (!window.confirm(`Are you sure you want to delete ${row.name || `${row.first_name} ${row.last_name}`}?\nNote: Resources linked to active tasks or historical production records cannot be deleted.`)) return;

    const { error: deleteError } = await client.from(type).delete().eq("id", row.id);
    if (deleteError) setError(formatFirebaseError(deleteError));
    else {
      await loadData();
      flash("Resource deleted successfully.");
    }
  };

  const taskAction = async (action, task) => {
    if (!isAdmin) {
      setError("Production state changes require manager permissions.");
      return;
    }
    try {
      if (action === "edit") {
        setDataModal({ mode: "edit-task", task });
        return;
      }
      if (action === "record") {
        setDataModal({ mode: "record", task });
        return;
      }
      if (action === "cancel" && !window.confirm(`Cancel Task #${task.task_number}: "${task.title}"?\nThis will release reserved raw materials back to inventory.`)) return;

      const rpc = action === "start" ? "start_production_task" : "cancel_production_task";
      const { error: actionError } = await client.rpc(rpc, { p_task_id: task.id });
      if (actionError) throw actionError;
      await loadData();
      flash(action === "start" ? "Task status updated to In Progress." : "Task cancelled. Reserved stock released to inventory.");
    } catch (actionError) {
      setError(formatFirebaseError(actionError));
    }
  };

  const dataModalSubmit = async (event) => {
    event.preventDefault();
    if (!isAdmin) {
      setError("Admin access required.");
      return;
    }
    const modal = dataModal;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      if (modal.mode === "record") {
        const { error: recordError } = await client.rpc("record_production", {
          p_task_id: modal.task.id,
          p_good_units: Number(form.get("good_units")),
          p_rejected_units: Number(form.get("rejected_units")),
          p_notes: form.get("notes") || "",
        });
        if (recordError) throw recordError;
      } else if (modal.mode === "edit-task") {
        const { error: editError } = await client.from("production_tasks").update({
          title: form.get("title").trim(),
          description: form.get("description").trim(),
          priority: form.get("priority"),
          planned_quantity: Number(form.get("planned_quantity")),
        }).eq("id", modal.task.id);
        if (editError) throw editError;
      }
      setDataModal(null);
      await loadData();
      flash(modal.mode === "record" ? "Production record registered." : "Production task details updated.");
    } catch (saveError) {
      setError(formatFirebaseError(saveError));
    } finally {
      setBusy(false);
    }
  };

  const markRead = async (notification) => {
    const { error: readError } = await client.rpc("mark_notification_read", { p_notification_id: notification.id });
    if (readError) setError(formatFirebaseError(readError));
    else await loadData();
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    if (!isAdmin) {
      setError("Modifying factory settings requires Factory Administrator permissions.");
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const get = (key) => formElement.elements.namedItem(key);
    const payload = {
      id: true,
      workspace_name: form.get("workspace_name"),
      plant_location: form.get("plant_location"),
      time_zone: form.get("time_zone"),
      max_employee_workload_percent: Number(form.get("max_employee_workload_percent")),
      prioritize_skill_match: get("prioritize_skill_match").checked,
      reserve_reorder_stock: get("reserve_reorder_stock").checked,
      conflict_notifications: get("conflict_notifications").checked,
      low_stock_notifications: get("low_stock_notifications").checked,
      daily_shift_summary: get("daily_shift_summary").checked,
      shift_a_start: form.get("shift_a_start"),
      shift_a_end: form.get("shift_a_end"),
      shift_b_start: form.get("shift_b_start"),
      shift_b_end: form.get("shift_b_end"),
    };
    setBusy(true);
    const { error: settingsError } = await client.from("factory_settings").upsert(payload, { onConflict: "id" });
    if (settingsError) setError(formatFirebaseError(settingsError));
    else {
      await loadData();
      flash("Factory allocation rules and settings successfully saved to Firestore.");
    }
    setBusy(false);
  };

  const handleSeedDemo = async () => {
    if (!isAdmin) {
      setError("Administrator access is required to seed factory data.");
      return;
    }
    if (!window.confirm("Load College Demo Dataset?\n\nThis will safely provision sample employees, machines, materials, and active production tasks into your Firestore database for college evaluation and viva presentation.")) return;

    setBusy(true);
    try {
      await client.seedDemoData();
      await loadData();
      flash("College Demo Dataset successfully loaded into Firestore!");
    } catch (seedErr) {
      setError(formatFirebaseError(seedErr));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    await loadData();
    flash("Factory data synchronized with Firestore.");
  };

  const activeTasks = data.tasks.filter((task) => ["scheduled", "in_progress"].includes(task.status));
  const unread = data.notifications.filter((item) => !item.is_read).length;
  const currentPageCopy = PAGE_COPY[page] || PAGE_COPY.Overview;
  const themeButton = (
    <button
      className="icon-button header-icon"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );

  const filteredTasks = data.tasks.filter((task) => {
    const allocation = allocationsByTask.get(task.id);
    const employee = getEmployee(allocation?.employee_id);
    const machine = getMachine(allocation?.machine_id);
    const material = getMaterial(task.material_id);
    return `${task.title} ${task.status} ${employee?.first_name} ${employee?.last_name} ${machine?.machine_code} ${material?.name}`
      .toLowerCase().includes(search.toLowerCase());
  });

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="brand-mark"><Factory size={24} /></div>
        <div className="spinner" />
        <span>Connecting to Smart Factory Database…</span>
      </div>
    );
  }

  // Auth Screen
  if (!session || !profile) {
    return (
      <div className="auth-page">
        <div className="auth-decoration auth-decoration-one" />
        <div className="auth-decoration auth-decoration-two" />
        <span className="auth-theme-toggle">{themeButton}</span>
        <div className="auth-brand">
          <span className="brand-symbol"><Factory size={21} /></span>
          <span>SRAS<span className="brand-period">.</span></span>
        </div>
        <div className="auth-layout">
          <section className="auth-story">
            <span className="eyebrow"><span className="status-dot" /> SMART FACTORY RESOURCE ALLOCATION SYSTEM</span>
            <h1>Smart planning.<br /><span>Zero conflict.</span></h1>
            <p>
              An intelligent manufacturing resource allocation engine. Match qualified operators, suitable machines, and raw inventory safely in real time.
            </p>
            <div className="auth-proof">
              <div className="proof-avatars"><i>OP</i><i>MC</i><i>MT</i></div>
              <span>Multi-constraint heuristics · Overlap prevention · ACID transactions</span>
            </div>
          </section>

          <section className="auth-card">
            <div className="auth-card-mark"><ShieldCheck size={19} /></div>
            <span className="eyebrow">FACTORY WORKSPACE ACCESS</span>
            <h2>Sign in</h2>
            <p>Enter your factory account credentials to access operations.</p>
            {error && <ErrorBanner message={error} onClose={() => setError("")} />}
            {!hasFirebaseConfiguration() ? (
              <div className="notice-card">
                <strong>Firebase configuration needed</strong>
                <span>Set the Firebase web app configuration in <code>frontend/.env</code>.</span>
              </div>
            ) : (
              <form className="form-stack" onSubmit={signIn}>
                <Field
                  label="Work email"
                  type="email"
                  autoComplete="username"
                  placeholder="admin@factory.local"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                <Field
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button className="text-button forgot-button" type="button" disabled={busy} onClick={resetPassword}>
                  Forgot password?
                </button>
                <Button variant="primary" className="auth-submit" type="submit" disabled={busy}>
                  {busy ? "Authenticating with Firebase…" : "Sign in to Factory Workspace"} <ArrowRight size={16} />
                </Button>
              </form>
            )}
            <div className="auth-security">
              <ShieldCheck size={14} /> Secured by Firebase Authentication and Firestore Security Rules.
            </div>
          </section>
        </div>
        <span className="auth-version">SMART FACTORY RESOURCE ALLOCATION SYSTEM <span>·</span> COLLEGE PROJECT DEMO</span>
      </div>
    );
  }

  const notificationBell = (
    <button
      className={`icon-button header-icon ${unread ? "has-notifications" : ""}`}
      aria-label={`${unread} unread notifications`}
      onClick={() => navigate("Notifications")}
    >
      <Bell size={18} />
    </button>
  );

  return (
    <div className="app-frame">
      {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <button className="brand brand-button" onClick={() => navigate("Overview")}>
          <span className="brand-symbol"><Factory size={20} /></span>
          <span>SRAS<span className="brand-period">.</span></span>
          <span className="brand-beta">FACTORY OS</span>
        </button>

        <div className="plant-switcher">
          <span className="plant-avatar">SF</span>
          <span>
            <strong>{data.settings?.workspace_name || "Smart Factory SRAS"}</strong>
            <small>{data.settings?.plant_location || "Plant 01 - Industrial Sector"}</small>
          </span>
          <ChevronDown size={15} />
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {group.items.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={`nav-link ${page === id ? "nav-link-active" : ""}`}
                  onClick={() => navigate(id)}
                >
                  <Icon size={17} strokeWidth={1.8} />
                  <span>{label}</span>
                  {id === "Production" && activeTasks.length > 0 && <b>{activeTasks.length}</b>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="support-card">
            <span className="support-icon"><Sparkles size={17} /></span>
            <strong>Smart Allocation Guide</strong>
            <p>Understand the multi-constraint resource matching algorithm.</p>
            <button
              className="text-button"
              style={{ color: "#bce995", fontSize: "9px", padding: 0 }}
              onClick={() => setExplainerModal(true)}
            >
              View Algorithm Logic <ArrowRight size={13} />
            </button>
          </div>

          <button className="profile-menu" onClick={signOut}>
            <span className="profile-avatar">{initials(profile)}</span>
            <span className="profile-details">
              <strong>{profile.display_name || "Factory Administrator"}</strong>
              <small>{profile.role === "admin" ? "Role: Factory Admin" : "Role: Operator (View Only)"}</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle navigation">
              <Menu size={19} />
            </button>
            <div className="breadcrumbs">
              <span>Smart Factory</span>
              <ChevronRight size={13} />
              <strong>{page}</strong>
            </div>
          </div>
          <div className="topbar-right">
            <label className="global-search">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter records…" />
              <kbd>⌘ K</kbd>
            </label>
            <button
              className="button button-secondary"
              style={{ height: "34px", padding: "0 10px", fontSize: "9px" }}
              onClick={() => setExplainerModal(true)}
            >
              <Cpu size={14} /> Allocation Engine
            </button>
            {themeButton}
            {notificationBell}
            <span className="topbar-divider" />
            <span className="today-label">
              <CalendarDays size={15} />
              {new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </span>
          </div>
        </header>

        <main className="main-area">
          {!isAdmin && (
            <div className="operator-banner">
              <div className="operator-banner-left">
                <ShieldCheck size={16} />
                <span>
                  <strong>Signed in as Operator ({profile.email}).</strong> Read-only access enabled. Production scheduling, resource management, and settings configuration require Factory Manager / Admin permissions.
                </span>
              </div>
            </div>
          )}

          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="status-dot" /> LIVE FACTORY WORKSPACE</div>
              <h1>
                {page === "Overview" ? `${currentPageCopy[0]}, ${profile.display_name?.split(" ")[0] || "Manager"}` : currentPageCopy[0]}
                <span className="heading-spark">✳</span>
              </h1>
              <p>{currentPageCopy[1]}</p>
            </div>
            <div className="heading-actions">
              <Button onClick={refresh} disabled={dataLoading}>
                <RefreshCw size={15} className={dataLoading ? "animate-spin" : ""} />
                {dataLoading ? "Syncing…" : "Refresh"}
              </Button>
              {isAdmin && ["Overview", "Production"].includes(page) && (
                <Button variant="primary" onClick={openTask}>
                  <Plus size={16} /> New production task
                </Button>
              )}
            </div>
          </div>

          {error && <ErrorBanner message={error} onClose={() => setError("")} />}
          {dataLoading && <div className="loading-bar"><span /></div>}

          {page === "Overview" && (
            <OverviewPage
              data={data}
              activeTasks={activeTasks}
              allocationsByTask={allocationsByTask}
              getEmployee={getEmployee}
              getMachine={getMachine}
              getMaterial={getMaterial}
              navigate={navigate}
              onTaskAction={taskAction}
              onMarkRead={markRead}
              onOpenExplainer={() => setExplainerModal(true)}
              onSeedDemo={handleSeedDemo}
              onShowAllocationDetail={(allocation, task) => setAllocationDetailModal({ allocation, task })}
              isAdmin={isAdmin}
            />
          )}

          {page === "Production" && (
            <ProductionPage
              tasks={filteredTasks}
              records={data.records}
              allocationsByTask={allocationsByTask}
              getEmployee={getEmployee}
              getMachine={getMachine}
              getMaterial={getMaterial}
              onTaskAction={taskAction}
              onShowAllocationDetail={(allocation, task) => setAllocationDetailModal({ allocation, task })}
              isAdmin={isAdmin}
            />
          )}

          {page === "Resources" && (
            <ResourcesPage
              data={data}
              tab={resourceTab}
              setTab={setResourceTab}
              onAdd={openResource}
              onEdit={openResource}
              onDelete={confirmDeleteResource}
              isAdmin={isAdmin}
            />
          )}

          {page === "Schedule" && (
            <SchedulePage
              data={data}
              allocationsByTask={allocationsByTask}
              getEmployee={getEmployee}
              getMachine={getMachine}
              getMaterial={getMaterial}
              onShowAllocationDetail={(allocation, task) => setAllocationDetailModal({ allocation, task })}
            />
          )}

          {page === "Analytics" && <AnalyticsPage data={data} getMaterial={getMaterial} />}

          {page === "Team" && (
            <TeamPage
              employees={data.employees.filter((employee) =>
                `${employee.first_name} ${employee.last_name} ${employee.skills?.join(" ")}`.toLowerCase().includes(search.toLowerCase())
              )}
              onAdd={() => openResource("employees")}
              onEdit={(row) => openResource("employees", row)}
              onDelete={(row) => confirmDeleteResource("employees", row)}
              isAdmin={isAdmin}
            />
          )}

          {page === "Settings" && (
            <SettingsPage
              settings={data.settings}
              onSave={saveSettings}
              onSeedDemo={handleSeedDemo}
              busy={busy}
              isAdmin={isAdmin}
            />
          )}

          {page === "Notifications" && (
            <NotificationsPage
              notifications={data.notifications.filter((item) =>
                `${item.title} ${item.message}`.toLowerCase().includes(search.toLowerCase())
              )}
              onMarkRead={markRead}
            />
          )}

          <footer className="page-footer">
            <span>© {new Date().getFullYear()} Smart Factory Resource Allocation System (SRAS)</span>
            <span><span className="status-dot" /> Cloud Firestore & Authentication Connected</span>
            <span>College Presentation Project</span>
          </footer>
        </main>
      </div>

      {taskModal && (
        <TaskModal
          data={data}
          materials={data.materials.filter((m) => m.is_active)}
          busy={busy}
          onClose={() => setTaskModal(false)}
          onSubmit={taskFormSubmit}
          onOpenExplainer={() => setExplainerModal(true)}
        />
      )}

      {explainerModal && (
        <AlgorithmExplainerModal onClose={() => setExplainerModal(false)} />
      )}

      {allocationDetailModal && (
        <AllocationDetailModal
          modal={allocationDetailModal}
          getEmployee={getEmployee}
          getMachine={getMachine}
          getMaterial={getMaterial}
          onClose={() => setAllocationDetailModal(null)}
        />
      )}

      {dataModal?.mode === "resource" && (
        <ResourceModal modal={dataModal} busy={busy} onClose={() => setDataModal(null)} onSubmit={resourceSubmit} />
      )}

      {dataModal?.mode === "record" && (
        <RecordModal task={dataModal.task} busy={busy} onClose={() => setDataModal(null)} onSubmit={dataModalSubmit} />
      )}

      {dataModal?.mode === "edit-task" && (
        <EditTaskModal task={dataModal.task} busy={busy} onClose={() => setDataModal(null)} onSubmit={dataModalSubmit} />
      )}

      {toast && <div className="toast"><CheckCheck size={16} />{toast}</div>}
    </div>
  );
}

function StatCard({ label, value, detail, icon: Icon, tone = "green", trend }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon stat-${tone}`}><Icon size={18} /></div>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <div className="stat-meta">
        <span>{detail}</span>
        {trend && <em>{trend}</em>}
      </div>
    </article>
  );
}

function TaskTable({ tasks, allocationsByTask, getEmployee, getMachine, getMaterial, onTaskAction, onShowAllocationDetail, isAdmin }) {
  if (!tasks.length) {
    return (
      <EmptyState
        icon={Factory}
        title="No production tasks registered"
        description="Add resources in Resources tab, then schedule a task to evaluate the smart allocation engine."
      />
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Production task</th>
            <th>Assigned resources</th>
            <th>Allocation rationale</th>
            <th>Material usage</th>
            <th>Progress</th>
            <th>Priority</th>
            <th>Due</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const allocation = allocationsByTask.get(task.id);
            const employee = getEmployee(allocation?.employee_id);
            const machine = getMachine(allocation?.machine_id);
            const material = getMaterial(task.material_id);
            const progress = task.planned_quantity ? Math.min(100, Math.round((task.produced_quantity / task.planned_quantity) * 100)) : 0;
            const completed = ["completed", "cancelled"].includes(task.status);
            const rationaleText = allocation?.allocation_reasons?.employee || "Skill match & zero schedule overlap verified.";

            return (
              <tr key={task.id}>
                <td>
                  <div className="task-title-cell">
                    <span className="task-color-dot" />
                    <span>
                      <strong>{task.title}</strong>
                      <small>#{task.task_number} · {task.status.replace("_", " ")}</small>
                    </span>
                  </div>
                </td>
                <td>
                  <div className="assigned-cell">
                    <span className="assigned-person">{employee ? initials(employee) : "—"}</span>
                    <span>
                      <strong>{employee ? nameOf(employee) : "Unassigned"}</strong>
                      <small>{machine ? `${machine.machine_code} (${machine.machine_type})` : "No machine"}</small>
                    </span>
                  </div>
                </td>
                <td>
                  {allocation ? (
                    <button
                      className="rationale-tag"
                      title="Click to view detailed allocation decision breakdown"
                      onClick={() => onShowAllocationDetail(allocation, task)}
                    >
                      <Sparkles size={11} color="#60a5fa" />
                      <span>{rationaleText}</span>
                    </button>
                  ) : (
                    <small className="table-secondary">Manual assignment</small>
                  )}
                </td>
                <td>
                  <strong className="table-primary">{material?.name || "—"}</strong>
                  <small className="table-secondary">{moneyNumber(task.required_material_quantity)} {material?.unit || ""} reserved</small>
                </td>
                <td>
                  <div className="progress-cell">
                    <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
                    <small>{progress}% ({task.produced_quantity}/{task.planned_quantity})</small>
                  </div>
                </td>
                <td>
                  <span className={`priority priority-${task.priority}`}>{task.priority}</span>
                </td>
                <td><span className="table-date">{dateTime(task.end_at)}</span></td>
                <td>
                  {completed ? (
                    <span className={`status-pill ${task.status}`}>{task.status}</span>
                  ) : isAdmin ? (
                    <div className="row-actions">
                      <button title="Edit task specifications" onClick={() => onTaskAction("edit", task)}>
                        <MoreHorizontal size={16} />
                      </button>
                      {task.status === "scheduled" && (
                        <button title="Start task" onClick={() => onTaskAction("start", task)}>
                          <Play size={15} />
                        </button>
                      )}
                      <button title="Record good/rejected output units" onClick={() => onTaskAction("record", task)}>
                        <Plus size={15} />
                      </button>
                      <button title="Cancel task and release reserved stock" className="action-danger" onClick={() => onTaskAction("cancel", task)}>
                        <X size={15} />
                      </button>
                    </div>
                  ) : (
                    <span className="status-pill pill-gray">View only</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResourcePanel({ title, description, count, children, action }) {
  return (
    <Panel className="content-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title-row">
            <h2>{title}</h2>
            {count !== undefined && <span className="count-badge">{count}</span>}
          </div>
          <p>{description}</p>
        </div>
        {action}
      </div>
      {children}
    </Panel>
  );
}

function OverviewPage({
  data,
  activeTasks,
  allocationsByTask,
  getEmployee,
  getMachine,
  getMaterial,
  navigate,
  onTaskAction,
  onMarkRead,
  onOpenExplainer,
  onSeedDemo,
  onShowAllocationDetail,
  isAdmin,
}) {
  const availableEmployees = data.employees.filter((item) => item.is_active && item.is_available).length;
  const availableMachines = data.machines.filter((item) => item.is_active && item.status === "available").length;
  const stockReady = data.materials.filter((item) => Number(item.quantity_on_hand) - Number(item.quantity_reserved) > Number(item.reorder_point)).length;
  const produced = data.records.reduce((sum, item) => sum + item.good_units, 0);
  const maxOutput = Math.max(1, ...data.tasks.map((task) => task.produced_quantity || 0));

  return (
    <>
      <section className="welcome-banner">
        <div>
          <div className="welcome-overline"><Zap size={14} /> INTELLIGENT RESOURCE ALLOCATION ENGINE</div>
          <h2>Optimal shop floor matching.<br /><span>Zero scheduling conflicts.</span></h2>
          <p>Multi-constraint algorithmic matching ensures employee skills, machine compatibility, and material safety margins are respected on every production run.</p>
          <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
            <button className="welcome-link" onClick={() => navigate("Production")}>
              View production runs <ArrowRight size={15} />
            </button>
            <button className="welcome-link" style={{ background: "transparent", border: "1px solid #ffffff40" }} onClick={onOpenExplainer}>
              How matching works <Sparkles size={14} />
            </button>
          </div>
        </div>
        <div className="welcome-graphic">
          <div className="graphic-ring ring-one" />
          <div className="graphic-ring ring-two" />
          <div className="graphic-core"><Factory size={30} /></div>
          <span className="graphic-node node-a"><Users size={15} /></span>
          <span className="graphic-node node-b"><Wrench size={15} /></span>
          <span className="graphic-node node-c"><Package size={15} /></span>
          <span className="graphic-caption">SMART HEURISTIC ENGINE <i>ACTIVE</i></span>
        </div>
        <span className="banner-index">SRAS / FACTORY OS</span>
      </section>

      <section className="stats-grid">
        <StatCard label="Active tasks" value={activeTasks.length} detail="Scheduled or in-progress" icon={Factory} tone="green" />
        <StatCard label="Available operators" value={`${availableEmployees} / ${data.employees.length}`} detail="Skills verified & active" icon={Users} tone="blue" />
        <StatCard label="Machines ready" value={`${availableMachines} / ${data.machines.length}`} detail="Free & maintained" icon={Wrench} tone="orange" />
        <StatCard label="Materials above reorder" value={`${stockReady} / ${data.materials.length}`} detail="Safety stock intact" icon={Package} tone="purple" />
      </section>

      <section className="overview-grid">
        <Panel>
          <div className="panel-header">
            <div>
              <h2>Production output pulse</h2>
              <p>Produced units vs. planned volume</p>
            </div>
            <span className="live-badge"><i /> FIRESTORE SYNC</span>
          </div>
          {data.tasks.length ? (
            <div className="pulse-list">
              {data.tasks.slice(0, 5).map((task) => (
                <div className="pulse-row" key={task.id}>
                  <span className="pulse-name">{task.title}</span>
                  <div className="pulse-track">
                    <span style={{ width: `${Math.max(3, ((task.produced_quantity || 0) / maxOutput) * 100)}%` }} />
                  </div>
                  <strong>
                    {moneyNumber(task.produced_quantity, 0)}
                    <small> / {moneyNumber(task.planned_quantity, 0)}</small>
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Activity}
              title="No production tasks yet"
              description="Click 'Seed Demo Data' in Settings or create a task to view the live production chart."
              action={
                isAdmin ? (
                  <Button variant="primary" onClick={onSeedDemo} style={{ marginTop: "10px" }}>
                    <Database size={14} /> Load College Demo Dataset
                  </Button>
                ) : null
              }
            />
          )}
          <div className="chart-footnote">
            <span><i className="legend-swatch" /> Good finished units</span>
            <strong>{moneyNumber(produced, 0)} units total</strong>
          </div>
        </Panel>

        <Panel>
          <div className="panel-header">
            <div>
              <h2>Factory notifications & alerts</h2>
              <p>Conflict logs and inventory notices</p>
            </div>
            <button className="text-button" onClick={() => navigate("Notifications")}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          <NotificationList items={data.notifications.slice(0, 4)} onMarkRead={onMarkRead} />
        </Panel>
      </section>

      <ResourcePanel
        title="Current production tasks"
        description="Tasks scheduled by the allocation engine with conflict-free resource commitments"
        count={data.tasks.length}
        action={<Button onClick={() => navigate("Production")}>All production <ArrowRight size={14} /></Button>}
      >
        <TaskTable
          tasks={data.tasks.slice(0, 5)}
          allocationsByTask={allocationsByTask}
          getEmployee={getEmployee}
          getMachine={getMachine}
          getMaterial={getMaterial}
          onTaskAction={onTaskAction}
          onShowAllocationDetail={onShowAllocationDetail}
          isAdmin={isAdmin}
        />
      </ResourcePanel>
    </>
  );
}

function ProductionPage(props) {
  const { tasks, records, ...tableProps } = props;
  const open = tasks.filter((task) => ["scheduled", "in_progress"].includes(task.status));
  const goodUnits = records.reduce((sum, item) => sum + (item.good_units || 0), 0);
  const rejectedUnits = records.reduce((sum, item) => sum + (item.rejected_units || 0), 0);
  const yieldPercent = goodUnits + rejectedUnits ? Math.round((goodUnits / (goodUnits + rejectedUnits)) * 100) : 100;

  return (
    <>
      <section className="stats-grid compact-stats">
        <StatCard label="Active tasks" value={open.length} detail="Reserved or running" icon={Factory} />
        <StatCard label="Completed runs" value={tasks.filter((t) => t.status === "completed").length} detail="Fully produced" icon={Check} tone="blue" />
        <StatCard label="Good units output" value={moneyNumber(goodUnits, 0)} detail={`Yield rate: ${yieldPercent}%`} icon={Gauge} tone="purple" />
        <StatCard label="Scrap / rejected" value={moneyNumber(rejectedUnits, 0)} detail="Quality rejections" icon={AlertCircle} tone="orange" />
      </section>

      <ResourcePanel
        title="Production tasks & resource commitments"
        description="Every task reservation guarantees skill match, machine suitability, and time-slot conflict avoidance."
        count={tasks.length}
        action={<span className="live-badge"><i /> ATOMIC TRANSACTIONS</span>}
      >
        <TaskTable {...tableProps} tasks={tasks} />
      </ResourcePanel>

      <ResourcePanel title="Auditable production records" description="Append-only output entries logged by shop-floor operators" count={records.length}>
        <RecordTable records={records} tasks={tasks} />
      </ResourcePanel>
    </>
  );
}

function RecordTable({ records, tasks }) {
  if (!records.length) {
    return (
      <EmptyState
        icon={Activity}
        title="No production records yet"
        description="Record completed good and rejected units on active tasks to build an audit trail."
      />
    );
  }
  return (
    <Table headers={["Task", "Good units", "Rejected units", "Notes", "Recorded at"]}>
      {records.slice(0, 15).map((record) => (
        <tr key={record.id}>
          <td><strong>{tasks.find((task) => task.id === record.task_id)?.title || "Task removed"}</strong></td>
          <td><span className="status-pill pill-green"><Check size={11} /> {record.good_units} units</span></td>
          <td>{record.rejected_units > 0 ? <span className="status-pill pill-gray" style={{ color: "#c16750" }}>{record.rejected_units} scrap</span> : "0"}</td>
          <td>{record.notes || "—"}</td>
          <td>{dateTime(record.recorded_at)}</td>
        </tr>
      ))}
    </Table>
  );
}

function Table({ headers, children }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function ResourceTable({ type, rows, onEdit, onDelete, isAdmin }) {
  if (!rows.length) {
    return (
      <EmptyState
        icon={type === "employees" ? Users : type === "machines" ? Wrench : Package}
        title={`No ${type} registered`}
        description="Register factory resources to feed the smart allocation optimization model."
        action={
          isAdmin ? (
            <button className="button button-primary" onClick={() => onEdit(type, null)}>
              <Plus size={15} /> Add {type.slice(0, -1)}
            </button>
          ) : null
        }
      />
    );
  }

  const columnSets = {
    employees: ["Employee", "ID", "Job title", "Skills", "Shift", "Availability", "Workload"],
    machines: ["Machine", "Type", "Location", "Compatible materials", "Status"],
    materials: ["Material", "Category", "On hand", "Reserved", "Available", "Reorder buffer"],
  };

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columnSets[type].map((label) => <th key={label}>{label}</th>)}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {type === "employees" && (
                <>
                  <td>
                    <div className="assigned-cell">
                      <span className="assigned-person">{initials(row)}</span>
                      <strong>{nameOf(row)}</strong>
                    </div>
                  </td>
                  <td><code>{row.employee_number}</code></td>
                  <td>{row.job_title || "—"}</td>
                  <td>
                    {row.skills?.length ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                        {row.skills.map((s) => (
                          <span key={s} className="status-pill pill-gray" style={{ fontSize: "7px" }}>{s}</span>
                        ))}
                      </div>
                    ) : "—"}
                  </td>
                  <td><strong>{row.shift_name}</strong></td>
                  <td>
                    <StatusPill tone={row.is_active && row.is_available ? "green" : "gray"}>
                      {row.is_active && row.is_available ? "Available" : "Unavailable"}
                    </StatusPill>
                  </td>
                  <td>
                    <div className="progress-cell" style={{ minWidth: "80px" }}>
                      <div className="progress-track">
                        <span style={{ width: `${Math.min(100, row.workload_percent || 0)}%`, background: row.workload_percent > 80 ? "#e9a071" : undefined }} />
                      </div>
                      <small>{row.workload_percent}%</small>
                    </div>
                  </td>
                </>
              )}

              {type === "machines" && (
                <>
                  <td>
                    <strong className="table-primary">{row.machine_code}</strong>
                    <small className="table-secondary">{row.name}</small>
                  </td>
                  <td><span className="status-pill pill-gray" style={{ fontWeight: 600 }}>{row.machine_type}</span></td>
                  <td>{row.location || "—"}</td>
                  <td>{row.compatible_material_categories?.join(", ") || "—"}</td>
                  <td>
                    <StatusPill tone={row.status === "available" ? "green" : "gray"}>{row.status}</StatusPill>
                  </td>
                </>
              )}

              {type === "materials" && (
                <>
                  <td>
                    <strong className="table-primary">{row.name}</strong>
                    <small className="table-secondary">{row.sku}</small>
                  </td>
                  <td><span className="status-pill pill-gray">{row.category}</span></td>
                  <td>{moneyNumber(row.quantity_on_hand)} {row.unit}</td>
                  <td>{moneyNumber(row.quantity_reserved)} {row.unit}</td>
                  <td>
                    <strong style={{ color: Number(row.quantity_on_hand) - Number(row.quantity_reserved) <= Number(row.reorder_point) ? "#c16750" : "#5c8b3b" }}>
                      {moneyNumber(Number(row.quantity_on_hand) - Number(row.quantity_reserved))} {row.unit}
                    </strong>
                  </td>
                  <td>{moneyNumber(row.reorder_point)} {row.unit}</td>
                </>
              )}

              <td>
                {isAdmin ? (
                  <div className="row-actions">
                    <button title="Edit resource" onClick={() => onEdit(type, row)}>
                      <MoreHorizontal size={16} />
                    </button>
                    <button className="action-danger" title="Delete resource" onClick={() => onDelete(type, row)}>
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <span className="status-pill pill-gray">View only</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ children, tone = "green" }) {
  return <span className={`status-pill pill-${tone}`}><i />{children}</span>;
}

function ResourcesPage({ data, tab, setTab, onAdd, onEdit, onDelete, isAdmin }) {
  const tabs = [
    ["employees", "Employees", Users],
    ["machines", "Machines", Wrench],
    ["materials", "Materials", Package],
  ];
  const rows = data[tab] || [];
  const active = rows.filter((row) => row.is_active).length;

  return (
    <>
      <section className="stats-grid compact-stats">
        <StatCard label="Employees catalog" value={data.employees.length} detail="Registered technicians" icon={Users} />
        <StatCard label="Available machines" value={data.machines.filter((m) => m.status === "available" && m.is_active).length} detail={`of ${data.machines.length} total machines`} icon={Wrench} tone="blue" />
        <StatCard label="Tracked materials" value={data.materials.length} detail="Raw stock SKUs" icon={Package} tone="purple" />
        <StatCard label="Active in this category" value={active} detail={`Category: ${tab}`} icon={Activity} tone="orange" />
      </section>

      <Panel className="content-panel">
        <div className="resource-toolbar">
          <div className="segmented-tabs">
            {tabs.map(([key, label, Icon]) => (
              <button key={key} className={tab === key ? "segment-active" : ""} onClick={() => setTab(key)}>
                <Icon size={15} />
                {label}
                <span>{data[key].length}</span>
              </button>
            ))}
          </div>
          {isAdmin && (
            <Button variant="primary" onClick={() => onAdd(tab)}>
              <Plus size={15} /> Add {tab.slice(0, -1)}
            </Button>
          )}
        </div>
        <div className="table-caption">
          <div>
            <h2>{tabs.find(([key]) => key === tab)[1]} Directory</h2>
            <p>Live inventory and capacity data referenced by the allocation engine.</p>
          </div>
          <span className="live-badge"><i /> PERSISTENT FIRESTORE</span>
        </div>
        <ResourceTable type={tab} rows={rows} onEdit={onEdit} onDelete={onDelete} isAdmin={isAdmin} />
      </Panel>
    </>
  );
}

function TeamPage({ employees, onAdd, onEdit, onDelete, isAdmin }) {
  const available = employees.filter((item) => item.is_active && item.is_available).length;
  const workload = employees.length ? Math.round(employees.reduce((sum, employee) => sum + Number(employee.workload_percent || 0), 0) / employees.length) : 0;

  return (
    <>
      <section className="stats-grid compact-stats">
        <StatCard label="Team members" value={employees.length} detail="Operator profiles" icon={Users} />
        <StatCard label="Available now" value={available} detail="Ready for smart allocation" icon={Check} tone="blue" />
        <StatCard label="Average workload" value={`${workload}%`} detail="Across factory workforce" icon={Gauge} tone="purple" />
        <StatCard label="Skill verified" value={employees.filter((item) => item.skills?.length).length} detail="Profiles with skills catalogued" icon={HardHat} tone="orange" />
      </section>

      <ResourcePanel
        title="Workforce & skill profiles"
        description="The allocation engine balances workload across qualified operators to minimize fatigue."
        count={employees.length}
        action={isAdmin ? <Button variant="primary" onClick={onAdd}><Plus size={15} /> Add employee</Button> : null}
      >
        <ResourceTable type="employees" rows={employees} onEdit={(type, row) => onEdit(row)} onDelete={(type, row) => onDelete(row)} isAdmin={isAdmin} />
      </ResourcePanel>
    </>
  );
}

function SchedulePage({ data, allocationsByTask, getEmployee, getMachine, getMaterial, onShowAllocationDetail }) {
  const rows = data.allocations.map((allocation) => ({
    allocation,
    task: data.tasks.find((task) => task.id === allocation.task_id),
  })).filter(({ task }) => task);

  // Calculate timeline window
  const activeAllocations = rows.filter(({ allocation }) => ["reserved", "in_progress"].includes(allocation.status));
  const timeExtremes = activeAllocations.reduce((acc, { allocation }) => {
    const s = Date.parse(allocation.start_at);
    const e = Date.parse(allocation.end_at);
    if (!acc.min || s < acc.min) acc.min = s;
    if (!acc.max || e > acc.max) acc.max = e;
    return acc;
  }, { min: null, max: null });

  const timelineStart = timeExtremes.min || Date.now();
  const timelineSpan = Math.max(3600000 * 8, (timeExtremes.max || (Date.now() + 3600000 * 24)) - timelineStart);

  return (
    <>
      <section className="stats-grid compact-stats">
        <StatCard label="Total allocations" value={rows.length} detail="Reservations made" icon={CalendarDays} />
        <StatCard label="Active reservations" value={activeAllocations.length} detail="In progress or upcoming" icon={Clock3} tone="blue" />
        <StatCard label="Conflicting overlaps" value="0" detail="Enforced by transaction logic" icon={ShieldCheck} tone="green" />
        <StatCard label="Materials reserved" value={moneyNumber(data.materials.reduce((sum, m) => sum + Number(m.quantity_reserved || 0), 0))} detail="Across raw material SKUs" icon={Package} tone="purple" />
      </section>

      {/* Visual Timeline Bar */}
      <Panel className="content-panel">
        <div className="panel-header">
          <div>
            <h2>Resource allocation timeline</h2>
            <p>Visual verification of conflict-free scheduling across concurrent factory tasks</p>
          </div>
          <span className="live-badge"><i /> ZERO CONFLICTS</span>
        </div>

        {activeAllocations.length ? (
          <div className="timeline-card">
            {activeAllocations.map(({ allocation, task }) => {
              const startMillis = Date.parse(allocation.start_at);
              const endMillis = Date.parse(allocation.end_at);
              const leftPercent = Math.max(0, Math.min(95, ((startMillis - timelineStart) / timelineSpan) * 100));
              const widthPercent = Math.max(5, Math.min(100 - leftPercent, ((endMillis - startMillis) / timelineSpan) * 100));
              const emp = getEmployee(allocation.employee_id);
              const mach = getMachine(allocation.machine_id);

              return (
                <div className="timeline-row" key={allocation.id}>
                  <div className="timeline-task-name">
                    <strong>#{task.task_number} · {task.title}</strong>
                    <small>{nameOf(emp)} · {mach?.machine_code || "Machine"}</small>
                  </div>
                  <div className="timeline-bar-wrap">
                    <div
                      className={`timeline-bar status-${allocation.status}`}
                      style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                      title={`${task.title}: ${new Date(startMillis).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} to ${new Date(endMillis).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    >
                      {new Date(startMillis).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(endMillis).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <button
                    className="rationale-tag"
                    onClick={() => onShowAllocationDetail(allocation, task)}
                    style={{ fontSize: "7px" }}
                  >
                    <Info size={11} /> Match Details
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="No active schedule allocations"
            description="Create a task to see the timeline scheduler automatically place it into a conflict-free window."
          />
        )}
      </Panel>

      <Panel className="content-panel">
        <div className="panel-header">
          <div>
            <h2>Resource allocation registry</h2>
            <p>Complete historical and current allocation records</p>
          </div>
        </div>
        {rows.length ? (
          <Table headers={["Task", "Assigned employee", "Machine", "Material & quantity", "Time slot", "Status", "Rationale"]}>
            {rows.map(({ allocation, task }) => {
              const material = getMaterial(allocation.material_id);
              return (
                <tr key={allocation.id}>
                  <td>
                    <strong>{task.title}</strong>
                    <small className="table-secondary">#{task.task_number}</small>
                  </td>
                  <td>{nameOf(getEmployee(allocation.employee_id))}</td>
                  <td>{getMachine(allocation.machine_id)?.machine_code || "—"}</td>
                  <td>{material?.name || "—"} · {moneyNumber(allocation.reserved_material_quantity)} {material?.unit}</td>
                  <td>
                    <small>{dateTime(allocation.start_at)} → {dateTime(allocation.end_at)}</small>
                  </td>
                  <td>
                    <StatusPill tone={allocation.status === "cancelled" ? "gray" : "green"}>{allocation.status}</StatusPill>
                  </td>
                  <td>
                    <button
                      className="rationale-tag"
                      onClick={() => onShowAllocationDetail(allocation, task)}
                    >
                      <Sparkles size={11} color="#60a5fa" /> Breakdown
                    </button>
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : null}
      </Panel>
    </>
  );
}

function AnalyticsPage({ data, getMaterial }) {
  const good = data.records.reduce((sum, item) => sum + (item.good_units || 0), 0);
  const rejected = data.records.reduce((sum, item) => sum + (item.rejected_units || 0), 0);
  const totalProduced = good + rejected;
  const yieldPercent = totalProduced ? Math.round((good / totalProduced) * 100) : 100;
  const scrapPercent = totalProduced ? Math.round((rejected / totalProduced) * 100) : 0;
  const activeMachines = data.machines.filter((m) => m.status === "available" && m.is_active).length;
  const machineReadiness = data.machines.length ? Math.round((activeMachines / data.machines.length) * 100) : 100;
  const taskOutput = data.tasks.map((task) => ({
    task,
    ratio: task.planned_quantity ? (task.produced_quantity || 0) / task.planned_quantity : 0,
  })).slice(0, 6);

  return (
    <>
      <section className="stats-grid compact-stats">
        <StatCard label="Finished good units" value={moneyNumber(good, 0)} detail="Passed QA standards" icon={Check} tone="green" />
        <StatCard label="Production yield rate" value={`${yieldPercent}%`} detail={`Scrap rate: ${scrapPercent}%`} icon={Gauge} tone="blue" />
        <StatCard label="Machine readiness" value={`${machineReadiness}%`} detail={`${activeMachines} of ${data.machines.length} active`} icon={Wrench} tone="purple" />
        <StatCard label="Completed runs" value={data.tasks.filter((t) => t.status === "completed").length} detail={`of ${data.tasks.length} tasks scheduled`} icon={Factory} tone="orange" />
      </section>

      <section className="overview-grid">
        <Panel>
          <div className="panel-header">
            <div>
              <h2>Task plan vs. actual fulfillment</h2>
              <p>Percentage fulfillment of planned production targets</p>
            </div>
          </div>
          {taskOutput.length ? (
            <div className="analytics-bars">
              {taskOutput.map(({ task, ratio }) => (
                <div className="analytics-bar-row" key={task.id}>
                  <span>{task.title}</span>
                  <div className="analytics-bar-track">
                    <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                  </div>
                  <strong>{Math.round(ratio * 100)}%</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Gauge} title="No task execution data" description="Start tasks and record output to view completion fulfillment charts." />
          )}
        </Panel>

        <Panel>
          <div className="panel-header">
            <div>
              <h2>Material stock & safety buffers</h2>
              <p>Inventory level relative to minimum safety reorder thresholds</p>
            </div>
          </div>
          {data.materials.length ? (
            <div className="stock-list">
              {data.materials.slice(0, 8).map((material) => {
                const available = Number(material.quantity_on_hand) - Number(material.quantity_reserved);
                const percent = Number(material.quantity_on_hand) ? Math.min(100, (available / Number(material.quantity_on_hand)) * 100) : 0;
                const isLow = available <= Number(material.reorder_point);
                return (
                  <div className="stock-row" key={material.id}>
                    <span>
                      <strong>{material.name}</strong>
                      <small>{moneyNumber(available)} {material.unit} available ({moneyNumber(material.quantity_reserved)} reserved)</small>
                    </span>
                    <div className="stock-track">
                      <i className={isLow ? "stock-low" : ""} style={{ width: `${percent}%` }} />
                    </div>
                    <em>{isLow ? "Reorder Alert" : "Healthy Stock"}</em>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title="No material records" description="Register materials to monitor inventory buffers." />
          )}
        </Panel>
      </section>

      <ResourcePanel title="Historical production logs" description="Audit log of all production batches" count={data.records.length}>
        <RecordTable records={data.records} tasks={data.tasks} />
      </ResourcePanel>
    </>
  );
}

function NotificationList({ items, onMarkRead }) {
  if (!items.length) {
    return <EmptyState icon={Bell} title="No new notifications" description="Scheduling alerts, conflict logs, and stock warnings will appear here." />;
  }
  return (
    <div className="notification-list">
      {items.map((item) => (
        <article key={item.id} className={`notification-row ${item.is_read ? "" : "notification-unread"}`}>
          <span className="notification-dot" />
          <div className="notification-copy">
            <strong>{item.title}</strong>
            <p>{item.message}</p>
            <small>{dateTime(item.created_at)}</small>
          </div>
          {!item.is_read && (
            <button className="mark-read" title="Mark as read" onClick={() => onMarkRead(item)}>
              <Check size={15} />
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

function NotificationsPage({ notifications, onMarkRead }) {
  const unread = notifications.filter((item) => !item.is_read).length;
  return (
    <Panel className="content-panel">
      <div className="panel-header">
        <div>
          <h2>System Activity & Audit Logs</h2>
          <p>{unread} unread {unread === 1 ? "alert" : "alerts"}</p>
        </div>
      </div>
      <NotificationList items={notifications} onMarkRead={onMarkRead} />
    </Panel>
  );
}

function SettingToggle({ label, description, name, checked }) {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input type="checkbox" name={name} defaultChecked={checked} />
      <i />
    </label>
  );
}

function SettingsPage({ settings, onSave, onSeedDemo, busy, isAdmin }) {
  if (!settings) {
    return (
      <EmptyState
        icon={Settings2}
        title="Factory settings not initialized"
        description="The factory_settings/main document is missing in Firestore. Click below to initialize default factory settings."
        action={
          isAdmin ? (
            <Button variant="primary" onClick={onSeedDemo} style={{ marginTop: "12px" }}>
              Initialize Factory & Seed Demo Dataset
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <form className="settings-grid" onSubmit={onSave}>
      <Panel className="settings-card">
        <div className="panel-header">
          <div>
            <h2>Factory identity & timezone</h2>
            <p>Physical plant information</p>
          </div>
        </div>
        <Field label="Workspace name" name="workspace_name" defaultValue={settings.workspace_name} required />
        <Field label="Plant location" name="plant_location" defaultValue={settings.plant_location} />
        <Field label="Time zone" name="time_zone" defaultValue={settings.time_zone} required />
      </Panel>

      <Panel className="settings-card">
        <div className="panel-header">
          <div>
            <h2>Smart allocation rules</h2>
            <p>Heuristic thresholds enforced by the allocation engine</p>
          </div>
        </div>
        <Field
          label="Maximum operator workload threshold (%)"
          name="max_employee_workload_percent"
          type="number"
          min="1"
          max="100"
          defaultValue={settings.max_employee_workload_percent}
          required
        />
        <SettingToggle
          label="Enforce strict skill match"
          description="Filter candidates to only those who possess 100% of the required task skills."
          name="prioritize_skill_match"
          checked={settings.prioritize_skill_match}
        />
        <SettingToggle
          label="Protect reorder safety stock"
          description="Keep minimum reorder buffer untouchable during task material reservation."
          name="reserve_reorder_stock"
          checked={settings.reserve_reorder_stock}
        />
        <div className="secure-rule">
          <ShieldCheck size={16} />
          <span>
            <strong>Temporal Overlap Prevention is Active</strong>
            <small>Double-booking operators or machines is rejected at the database transaction layer.</small>
          </span>
        </div>
      </Panel>

      <Panel className="settings-card settings-card-wide">
        <div className="panel-header">
          <div>
            <h2>Factory shifts & notification triggers</h2>
            <p>Operational hours and automated system notices</p>
          </div>
        </div>
        <div className="settings-toggle-grid">
          <SettingToggle label="Conflict alerts" description="Log notifications when tasks are scheduled." name="conflict_notifications" checked={settings.conflict_notifications} />
          <SettingToggle label="Low-stock warnings" description="Trigger alert when available stock hits reorder point." name="low_stock_notifications" checked={settings.low_stock_notifications} />
          <SettingToggle label="Daily shift summary" description="Enable shift handover summary logging." name="daily_shift_summary" checked={settings.daily_shift_summary} />
        </div>
        <div className="shift-fields">
          <Field label="Shift A starts" name="shift_a_start" type="time" defaultValue={settings.shift_a_start} required />
          <Field label="Shift A ends" name="shift_a_end" type="time" defaultValue={settings.shift_a_end} required />
          <Field label="Shift B starts" name="shift_b_start" type="time" defaultValue={settings.shift_b_start} required />
          <Field label="Shift B ends" name="shift_b_end" type="time" defaultValue={settings.shift_b_end} required />
        </div>
        {isAdmin && (
          <div className="settings-actions">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save factory preferences"} <ArrowRight size={15} />
            </Button>
          </div>
        )}
      </Panel>

      {/* College Presentation & Demo Tools */}
      <Panel className="settings-card settings-card-wide" style={{ border: "1px dashed var(--line-strong)" }}>
        <div className="panel-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Database size={17} color="#5c8b3b" />
              <h2>College Evaluation & Demo Dataset</h2>
            </div>
            <p>Quickly populate realistic factory data (4 technicians, 4 machines, 5 materials, and active tasks) for college viva demo.</p>
          </div>
          {isAdmin && (
            <Button variant="primary" type="button" onClick={onSeedDemo} disabled={busy}>
              <Database size={15} /> Seed College Demo Data
            </Button>
          )}
        </div>
        <p style={{ margin: "5px 0 0", color: "var(--muted)", fontSize: "8px", lineHeight: "1.5" }}>
          This safe seed mechanism verifies whether data exists and non-destructively populates standard manufacturing test cases.
        </p>
      </Panel>
    </form>
  );
}

// Live Smart Allocation Simulator inside Task Creation Modal
function TaskModal({ data, materials, busy, onClose, onSubmit, onOpenExplainer }) {
  const [materialId, setMaterialId] = useState(materials[0]?.id || "");
  const [requiredMaterialQuantity, setRequiredMaterialQuantity] = useState("25");
  const [machineType, setMachineType] = useState("CNC");
  const [requiredSkills, setRequiredSkills] = useState("CNC");
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const later = new Date(now.getTime() + 4 * 3600000);
  const [startAt, setStartAt] = useState(localInputDate(now));
  const [endAt, setEndAt] = useState(localInputDate(later));

  const selectedMaterial = materials.find((item) => item.id === materialId);
  const availableStock = selectedMaterial ? Number(selectedMaterial.quantity_on_hand) - Number(selectedMaterial.quantity_reserved) : 0;
  const reorderBuffer = data.settings?.reserve_reorder_stock ? Number(selectedMaterial?.reorder_point || 0) : 0;
  const netFreeStock = availableStock - reorderBuffer;

  // Live heuristic calculation
  const startMillis = Date.parse(startAt);
  const endMillis = Date.parse(endAt);
  const isValidTime = endMillis > startMillis;
  const skillList = requiredSkills.split(",").map((s) => s.trim()).filter(Boolean);

  const activeAllocations = data.allocations.filter((a) => ["reserved", "in_progress"].includes(a.status));

  // Employee matching simulation
  const validEmployees = data.employees.filter((emp) => {
    if (!emp.is_active || !emp.is_available) return false;
    if (Number(emp.workload_percent || 0) > Number(data.settings?.max_employee_workload_percent ?? 85)) return false;
    if (data.settings?.prioritize_skill_match && !skillList.every((s) => (emp.skills || []).includes(s))) return false;
    const hasOverlap = activeAllocations.some((a) => a.employee_id === emp.id && startMillis < Date.parse(a.end_at) && Date.parse(a.start_at) < endMillis);
    return !hasOverlap;
  }).sort((a, b) => Number(a.workload_percent || 0) - Number(b.workload_percent || 0));

  const bestEmployee = validEmployees[0];

  // Machine matching simulation
  const validMachines = data.machines.filter((mach) => {
    if (!mach.is_active || mach.status !== "available") return false;
    if (String(mach.machine_type || "").toLowerCase() !== machineType.toLowerCase()) return false;
    if (selectedMaterial && !(mach.compatible_material_categories || []).some((cat) => String(cat).toLowerCase() === String(selectedMaterial.category || "").toLowerCase())) {
      return false;
    }
    const hasOverlap = activeAllocations.some((a) => a.machine_id === mach.id && startMillis < Date.parse(a.end_at) && Date.parse(a.start_at) < endMillis);
    return !hasOverlap;
  }).sort((a, b) => String(a.machine_code || "").localeCompare(String(b.machine_code || "")));

  const bestMachine = validMachines[0];
  const isStockOk = Number(requiredMaterialQuantity) <= netFreeStock && Number(requiredMaterialQuantity) > 0;
  const isFullyAllocatable = isValidTime && Boolean(bestEmployee) && Boolean(bestMachine) && isStockOk;

  return (
    <Modal
      title="Schedule production task"
      description="Define the production run. The smart allocation engine evaluates operator skills, machine compatibility, and material buffers in real time."
      onClose={onClose}
      wide
    >
      <form className="modal-form" onSubmit={onSubmit}>
        <Field label="Task name" name="title" placeholder="e.g. Precision CNC Impeller Housing Run" required />
        <Field label="Production notes" name="description" placeholder="Technical specifications and routing notes" />

        <div className="form-grid">
          <Field
            label="Required skills (comma separated)"
            name="required_skills"
            value={requiredSkills}
            onChange={(e) => setRequiredSkills(e.target.value)}
            placeholder="CNC, Precision Milling"
          />
          <label className="field">
            <span>Required machine type</span>
            <select name="machine_type" value={machineType} onChange={(e) => setMachineType(e.target.value)} required>
              <option value="CNC">CNC (Machining Center)</option>
              <option value="Lathe">Lathe (Turning)</option>
              <option value="Welder">Welder (Robotic Welding)</option>
              <option value="Assembly">Assembly (Automated Cell)</option>
            </select>
          </label>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Raw material required</span>
            <select name="material_id" value={materialId} onChange={(event) => setMaterialId(event.target.value)} required>
              {materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name} · {moneyNumber(Number(material.quantity_on_hand) - Number(material.quantity_reserved))} {material.unit} free
                </option>
              ))}
            </select>
            <small>
              {selectedMaterial ? (
                `${moneyNumber(availableStock)} ${selectedMaterial.unit} available · Reorder safety buffer: ${moneyNumber(selectedMaterial.reorder_point)} ${selectedMaterial.unit}`
              ) : "No active materials found"}
            </small>
          </label>
          <Field
            label={`Material quantity (${selectedMaterial?.unit || "units"})`}
            name="required_material_quantity"
            type="number"
            min="0.001"
            max={Math.max(0.001, netFreeStock)}
            step="0.001"
            value={requiredMaterialQuantity}
            onChange={(e) => setRequiredMaterialQuantity(e.target.value)}
            required
          />
        </div>

        <div className="form-grid">
          <Field label="Planned production units" name="planned_quantity" type="number" min="1" step="1" defaultValue="100" required />
          <label className="field">
            <span>Priority</span>
            <select name="priority" defaultValue="medium">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>

        <div className="form-grid">
          <Field label="Start time" name="start_at" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} required />
          <Field label="End time" name="end_at" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
        </div>

        {/* Live Allocation Preview Box */}
        <div className="allocation-preview-box">
          <div className="preview-header">
            <span className="preview-title">
              <Cpu size={14} color="#5c8b3b" /> Live Smart Allocation Preview
            </span>
            {isFullyAllocatable ? (
              <span className="preview-badge-ok"><CheckCircle2 size={12} /> Optimal Match Found</span>
            ) : (
              <span className="preview-badge-err"><AlertCircle size={12} /> Allocation Bottleneck</span>
            )}
          </div>

          <div className="preview-grid">
            <div className="preview-item">
              <span className="preview-label">Recommended Operator</span>
              <span className="preview-value" style={{ color: bestEmployee ? "var(--ink)" : "#c16750" }}>
                {bestEmployee ? nameOf(bestEmployee) : "No Operator Available"}
              </span>
              <span className="preview-desc">
                {bestEmployee
                  ? `Lowest workload (${bestEmployee.workload_percent}%), 100% skill match, 0 schedule overlaps.`
                  : "No technician with required skills free during this time slot."}
              </span>
            </div>

            <div className="preview-item">
              <span className="preview-label">Compatible Machine</span>
              <span className="preview-value" style={{ color: bestMachine ? "var(--ink)" : "#c16750" }}>
                {bestMachine ? `${bestMachine.machine_code} (${bestMachine.name})` : "No Machine Available"}
              </span>
              <span className="preview-desc">
                {bestMachine
                  ? `Machine type match, compatible with "${selectedMaterial?.category || 'Material'}", 0 overlaps.`
                  : `No ${machineType} machine is available or compatible with ${selectedMaterial?.category || 'material'}.`}
              </span>
            </div>

            <div className="preview-item">
              <span className="preview-label">Inventory Buffer</span>
              <span className="preview-value" style={{ color: isStockOk ? "var(--ink)" : "#c16750" }}>
                {isStockOk ? `${netFreeStock} ${selectedMaterial?.unit} usable` : "Stock Insufficient"}
              </span>
              <span className="preview-desc">
                {isStockOk
                  ? `Maintains ${reorderBuffer} ${selectedMaterial?.unit} emergency reorder safety buffer.`
                  : `Requested ${requiredMaterialQuantity} exceeds free stock ${Math.max(0, netFreeStock)}.`}
              </span>
            </div>
          </div>
        </div>

        <div className="smart-note">
          <Zap size={16} />
          <span>
            <strong>Atomic Heuristic Optimization</strong>
            <small>
              The system minimizes operator fatigue and machine idle time while guaranteeing zero overlapping schedules.
              <button
                type="button"
                className="text-button"
                style={{ marginLeft: "6px", color: "var(--green-strong)", textDecoration: "underline" }}
                onClick={onOpenExplainer}
              >
                Learn how algorithm works
              </button>
            </small>
          </span>
        </div>

        <div className="modal-actions">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !isFullyAllocatable}>
            {busy ? "Executing Transaction…" : "Commit Smart Allocation & Create Task"} <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Algorithm Explainer Modal for College Project Presentation
function AlgorithmExplainerModal({ onClose }) {
  return (
    <Modal
      title="How Smart Allocation Works (SRAS Engine)"
      description="College project reference: multi-constraint satisfaction, heuristic load balancing, and ACID transactional reservations."
      onClose={onClose}
      wide
    >
      <div className="explainer-steps">
        <div className="explainer-step">
          <span className="explainer-step-num">1</span>
          <div className="explainer-step-body">
            <strong>Phase 1: Hard Constraint Filtering</strong>
            <p>
              When a task is planned with a target time window [t_start, t_end], the candidate search space is filtered across three orthogonal domains:
            </p>
            <div className="explainer-code-box">
              • Operator Filter: Active == true AND Available == true AND Skills ⊇ RequiredSkills<br />
              • Machine Filter: Active == true AND Status == 'available' AND Category ∈ CompatibleCategories<br />
              • Material Filter: (QuantityOnHand - QuantityReserved) - SafetyBuffer ≥ RequiredQuantity
            </div>
          </div>
        </div>

        <div className="explainer-step">
          <span className="explainer-step-num">2</span>
          <div className="explainer-step-body">
            <strong>Phase 2: Temporal Overlap Prevention (Zero Double-Booking)</strong>
            <p>
              Candidates with active reservations ([t_alloc_start, t_alloc_end]) that intersect with the requested window are strictly eliminated:
            </p>
            <div className="explainer-code-box">
              Overlap Condition: (t_start &lt; t_alloc_end) AND (t_alloc_start &lt; t_end)<br />
              Guarantees no technician or CNC machine is assigned to multiple tasks simultaneously.
            </div>
          </div>
        </div>

        <div className="explainer-step">
          <span className="explainer-step-num">3</span>
          <div className="explainer-step-body">
            <strong>Phase 3: Multi-Objective Load Balancing</strong>
            <p>
              From the qualified pool, the optimal operator is selected by sorting on workload percentage ascending:
            </p>
            <div className="explainer-code-box">
              Objective Function: minimize(Operator.WorkloadPercent)<br />
              Subject to: WorkloadPercent ≤ MaxWorkloadThreshold (default: 85%)<br />
              Result: Balances factory workload evenly, prevents burnout, and optimizes shift productivity.
            </div>
          </div>
        </div>

        <div className="explainer-step">
          <span className="explainer-step-num">4</span>
          <div className="explainer-step-body">
            <strong>Phase 4: ACID Concurrency & Transactional Commit</strong>
            <p>
              Allocations are executed within a single Firestore transaction:
            </p>
            <div className="explainer-code-box">
              • Increments production task counter atomically<br />
              • Creates production_tasks and resource_allocations records with audit rationales<br />
              • Increments material quantity_reserved immediately, preventing negative stock<br />
              • Generates auditable notifications for shop-floor supervisors
            </div>
          </div>
        </div>
      </div>

      <div className="modal-actions" style={{ marginTop: "14px" }}>
        <Button variant="primary" type="button" onClick={onClose}>
          Close Explainer <Check size={14} />
        </Button>
      </div>
    </Modal>
  );
}

// Modal showing why an allocation was chosen
function AllocationDetailModal({ modal, getEmployee, getMachine, getMaterial, onClose }) {
  const { allocation, task } = modal;
  const employee = getEmployee(allocation.employee_id);
  const machine = getMachine(allocation.machine_id);
  const material = getMaterial(allocation.material_id);
  const reasons = allocation.allocation_reasons || {
    employee: `Selected ${nameOf(employee)}: Qualified skills match, optimal workload balance, zero schedule overlap.`,
    machine: `Selected Machine ${machine?.machine_code || 'M-01'}: Type match, material compatible, conflict-free.`,
    material: `Stock safely reserved (${allocation.reserved_material_quantity} ${material?.unit || 'units'}), safety buffer intact.`,
  };

  return (
    <Modal
      title={`Allocation Rationale · Task #${task.task_number}`}
      description={`Transparent algorithmic audit trail for "${task.title}"`}
      onClose={onClose}
    >
      <div style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
        <div className="preview-item">
          <span className="preview-label">Assigned Operator</span>
          <strong className="preview-value">{nameOf(employee)} ({employee?.employee_number})</strong>
          <span className="preview-desc" style={{ marginTop: "4px" }}>{reasons.employee}</span>
        </div>

        <div className="preview-item">
          <span className="preview-label">Assigned Machine</span>
          <strong className="preview-value">{machine?.name} ({machine?.machine_code})</strong>
          <span className="preview-desc" style={{ marginTop: "4px" }}>{reasons.machine}</span>
        </div>

        <div className="preview-item">
          <span className="preview-label">Raw Material Allocation</span>
          <strong className="preview-value">{material?.name} ({allocation.reserved_material_quantity} {material?.unit})</strong>
          <span className="preview-desc" style={{ marginTop: "4px" }}>{reasons.material}</span>
        </div>

        <div className="preview-item">
          <span className="preview-label">Reservation Schedule Window</span>
          <strong className="preview-value">{dateTime(allocation.start_at)} → {dateTime(allocation.end_at)}</strong>
          <span className="preview-desc">Status: {allocation.status.toUpperCase()}</span>
        </div>
      </div>

      <div className="modal-actions" style={{ marginTop: "14px" }}>
        <Button variant="primary" type="button" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

function ResourceModal({ modal, busy, onClose, onSubmit }) {
  const fields = RESOURCE_FIELDS[modal.type];
  const singular = modal.type.slice(0, -1);
  return (
    <Modal
      title={`${modal.row ? "Edit" : "Add"} ${singular}`}
      description="Changes are committed directly to Cloud Firestore with uniqueness verification."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={onSubmit}>
        {fields.map(([name, label, type, required]) => {
          const value = modal.row?.[name];
          if (type === "checkbox") {
            return <SettingToggle key={name} label={label} description="" name={name} checked={value ?? true} />;
          }
          if (type.startsWith("select:")) {
            return (
              <label className="field" key={name}>
                <span>{label}</span>
                <select name={name} defaultValue={value || type.slice(7).split(",")[0]} required={required}>
                  {type.slice(7).split(",").map((item) => (
                    <option key={item} value={item}>{item.replace("_", " ")}</option>
                  ))}
                </select>
              </label>
            );
          }
          const display = Array.isArray(value) ? value.join(", ") : (value ?? "");
          return (
            <Field
              key={name}
              label={label}
              name={name}
              type={type}
              defaultValue={display}
              required={required}
              min={type === "number" ? "0" : undefined}
              step={type === "number" ? "0.001" : undefined}
            />
          );
        })}
        <div className="modal-actions">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save resource"} <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RecordModal({ task, busy, onClose, onSubmit }) {
  const remaining = (task.planned_quantity || 0) - (task.produced_quantity || 0);
  return (
    <Modal
      title={`Log production output · ${task.title}`}
      description={`${moneyNumber(task.produced_quantity, 0)} of ${moneyNumber(task.planned_quantity, 0)} units completed. ${moneyNumber(remaining, 0)} units remaining.`}
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={onSubmit}>
        <Field label="Good finished units" name="good_units" type="number" min="0" max={remaining} defaultValue="0" required />
        <Field label="Rejected scrap units" name="rejected_units" type="number" min="0" max={remaining} defaultValue="0" required />
        <Field label="Shift QA notes" name="notes" placeholder="Batch inspection notes (optional)" />
        <div className="modal-actions">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Recording…" : "Save production record"} <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditTaskModal({ task, busy, onClose, onSubmit }) {
  return (
    <Modal
      title="Edit production task"
      description="Update task target description and planned quantity. Existing resource allocations remain locked."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={onSubmit}>
        <Field label="Task name" name="title" defaultValue={task.title} required />
        <Field label="Description" name="description" defaultValue={task.description} />
        <label className="field">
          <span>Priority</span>
          <select name="priority" defaultValue={task.priority}>
            {["low", "medium", "high", "urgent"].map((item) => (
              <option value={item} key={item}>{item}</option>
            ))}
          </select>
        </label>
        <Field
          label="Planned units"
          name="planned_quantity"
          type="number"
          min={Math.max(1, task.produced_quantity || 0)}
          defaultValue={task.planned_quantity}
          required
        />
        <div className="modal-actions">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save changes"} <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}

createRoot(document.getElementById("root")).render(<App />);
