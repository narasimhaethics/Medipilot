import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowRight, ArrowUpRight, Bell, CalendarDays,
  Check, CheckCircle2, ChevronDown, ClipboardList, Clock3, FileCheck2,
  FileHeart, FilePlus2, HeartPulse, LayoutDashboard, LogOut, Menu, MessageCircle,
  Search, ShieldCheck, Sparkles, Stethoscope, UploadCloud, Users, X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

type Role = "PATIENT" | "DOCTOR" | "ADMIN";
type User = { id: string; name: string; email: string; role: Role; specialty: string | null; department: string | null };
type RecordItem = { id: string; title: string; category: string; summary: string; recordedAt: string };
type Appointment = { id: string; startsAt: string; reason: string; status: string; patient: { id: string; name: string }; doctor: { id: string; name: string; specialty: string | null } };
type Doctor = { id: string; name: string; specialty: string | null; department: string | null };
type OcrJob = { id: string; fileName: string; mimeType: string; status: string; demo: boolean; createdAt: string; fields: { name: string; value: string | null; confidence: number | null; state: string; sourceText: string | null }[] };
type FollowUp = { id: string; title: string; dueAt: string; completed: boolean };
type Prescription = { id: string; title: string; finalizedAt: string; items: { medicine: string; strength: string | null; dosage: string; frequency: string; duration: string | null; instructions: string | null }[] };
type Page = "overview" | "appointments" | "records" | "ocr" | "copilot" | "patients" | "verification" | "consultation" | "analytics";

const demoAccounts = [
  { role: "PATIENT" as const, email: "patient@medipilot.demo", password: "MediPilot123!", label: "Patient" },
  { role: "DOCTOR" as const, email: "doctor@medipilot.demo", password: "MediPilot123!", label: "Doctor" },
  { role: "ADMIN" as const, email: "admin@medipilot.demo", password: "MediPilot123!", label: "Administrator" },
];

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message ?? "We couldn't complete that request. Please try again.");
  return payload as T;
}

const dateLabel = (date: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Intl.DateTimeFormat("en", options).format(new Date(date));
const timeLabel = (date: string) => new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(date));
const initials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const chartData = [
  { day: "Mon", visits: 18 }, { day: "Tue", visits: 24 }, { day: "Wed", visits: 20 },
  { day: "Thu", visits: 32 }, { day: "Fri", visits: 26 }, { day: "Sat", visits: 14 }, { day: "Sun", visits: 21 },
];
const routePages: Record<string, Page> = {
  overview: "overview", appointments: "appointments", records: "records", ocr: "ocr",
  copilot: "copilot", patients: "patients", verification: "verification",
  consultation: "consultation", analytics: "analytics",
};
const rolePages: Record<Role, Page[]> = {
  PATIENT: ["overview", "appointments", "records", "ocr", "copilot"],
  DOCTOR: ["overview", "appointments", "patients", "verification", "consultation"],
  ADMIN: ["overview", "patients", "analytics"],
};
const LazyAnalyticsChart = lazy(() => import("./AnalyticsChart").then((module) => ({ default: module.AnalyticsChart })));

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const page = routePages[location.pathname.split("/").at(-1) ?? ""] ?? "overview";
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);

  const refreshSession = useCallback(async () => {
    try {
      const result = await api<{ user: User }>("/api/auth/me");
      setUser(result.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refreshSession(); }, [refreshSession]);
  useEffect(() => {
    if (loading) return;
    if (!user) {
      if (location.pathname !== "/") navigate("/", { replace: true });
      return;
    }
    const pageKey = location.pathname.split("/").at(-1) ?? "";
    const currentPage = routePages[pageKey];
    if (!currentPage || !rolePages[user.role].includes(currentPage)) navigate(`/${user.role.toLowerCase()}/overview`, { replace: true });
  }, [loading, location.pathname, navigate, user]);
  const goPage = (nextPage: Page) => {
    if (user && rolePages[user.role].includes(nextPage)) navigate(`/${user.role.toLowerCase()}/${nextPage}`);
  };

  const signIn = async (email: string, password: string) => {
    setBusy(true); setError("");
    try {
      const result = await api<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setUser(result.user); navigate(`/${result.user.role.toLowerCase()}/overview`, { replace: true }); setNotice(`Welcome back, ${result.user.name.startsWith("Dr.") ? result.user.name : result.user.name.split(" ")[0]}.`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    try { await api("/api/auth/logout", { method: "POST" }); }
    finally { setUser(null); navigate("/", { replace: true }); }
  };

  if (loading) return <div className="splash"><div className="brand-mark"><HeartPulse size={23} /></div><span>Preparing your care space…</span></div>;
  if (!user) return <LoginScreen onLogin={signIn} busy={busy} error={error} />;

  const nav: { key: Page; label: string; icon: typeof LayoutDashboard }[] = user.role === "PATIENT"
    ? [
      { key: "overview", label: "Overview", icon: LayoutDashboard },
      { key: "appointments", label: "Appointments", icon: CalendarDays },
      { key: "records", label: "My health records", icon: FileHeart },
      { key: "ocr", label: "Prescription scan", icon: FilePlus2 },
      { key: "copilot", label: "Health copilot", icon: MessageCircle },
    ]
    : user.role === "DOCTOR"
      ? [
        { key: "overview", label: "Overview", icon: LayoutDashboard },
        { key: "patients", label: "My patients", icon: Users },
        { key: "verification", label: "Prescription review", icon: FileCheck2 },
        { key: "consultation", label: "Clinical workspace", icon: Stethoscope },
        { key: "appointments", label: "Appointments", icon: CalendarDays },
      ]
      : [
        { key: "overview", label: "Overview", icon: LayoutDashboard },
        { key: "analytics", label: "Operations analytics", icon: Activity },
        { key: "patients", label: "Care team", icon: Users },
      ];
  const title: Record<Page, string> = {
    overview: "Overview", appointments: "Appointments", records: "My health records", ocr: "Prescription scan",
    copilot: "Health copilot", patients: user.role === "ADMIN" ? "Care team" : "My patients",
    verification: "Prescription review", consultation: "Clinical workspace", analytics: "Operations analytics",
  };
  return (
    <div className="app-shell">
      {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <a className="brand" href={`/${user.role.toLowerCase()}/overview`} onClick={(event) => { event.preventDefault(); goPage("overview"); }}>
          <span className="brand-mark"><HeartPulse size={22} strokeWidth={2.3} /></span>
          <span className="brand-copy"><strong>medipilot<span>AI</span></strong><small>CARE, CONNECTED</small></span>
          <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={(event) => { event.preventDefault(); setMobileNav(false); }}><X size={18} /></button>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {nav.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => { goPage(key); setMobileNav(false); setError(""); }} className={`nav-item ${page === key ? "active" : ""}`}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note"><ShieldCheck size={17} /><div><strong>Your care, protected</strong><span>Private by design</span></div></div>
          <button className="profile-row" onClick={() => void signOut()}>
            <Avatar name={user.name} />
            <span className="profile-text"><strong>{user.name}</strong><small>{roleLabel(user.role)}</small></span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button menu-toggle" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{title[page]}</strong></div>
          <div className="topbar-actions"><span className="today-label">{new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</span><button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotice("You’re all caught up on notifications.")}><Bell size={18} /><i /></button><Avatar name={user.name} small /></div>
        </header>
        <section className="page-content">
          {error && <div className="alert alert-error" role="alert"><X size={16} />{error}<button onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button></div>}
          {notice && <div className="alert alert-success" role="status"><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={16} /></button></div>}
          {page === "overview" && <Overview user={user} go={goPage} setError={setError} />}
          {page === "appointments" && <Appointments user={user} setError={setError} setNotice={setNotice} />}
          {page === "records" && <Records setError={setError} />}
          {page === "ocr" && <OcrPatient setError={setError} setNotice={setNotice} />}
          {page === "copilot" && <Copilot setError={setError} />}
          {page === "patients" && <Patients user={user} setError={setError} />}
          {page === "verification" && <Verification setError={setError} setNotice={setNotice} />}
          {page === "consultation" && <Consultation setError={setError} setNotice={setNotice} />}
          {page === "analytics" && <Analytics setError={setError} />}
        </section>
      </main>
    </div>
  );
}

function roleLabel(role: Role) { return role === "PATIENT" ? "Patient account" : role === "DOCTOR" ? "Care team · Cardiology" : "Hospital administrator"; }
function Avatar({ name, small = false }: { name: string; small?: boolean }) { return <span className={`avatar ${small ? "avatar-small" : ""}`}>{initials(name)}</span>; }
function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}
function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="section-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}
function StatCard({ icon: Icon, label, value, change, accent = "blue" }: { icon: typeof Activity; label: string; value: string | number; change?: string; accent?: string }) {
  return <article className="stat-card"><span className={`stat-icon ${accent}`}><Icon size={19} /></span><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong>{change && <span className="stat-change"><ArrowUpRight size={13} />{change}</span>}</article>;
}
function EmptyState({ icon: Icon, title, body }: { icon: typeof Activity; title: string; body: string }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={21} /></span><strong>{title}</strong><p>{body}</p></div>;
}

function LoginScreen({ onLogin, busy, error }: { onLogin: (email: string, password: string) => void; busy: boolean; error: string }) {
  const [email, setEmail] = useState(demoAccounts[0].email);
  const [password, setPassword] = useState(demoAccounts[0].password);
  const [active, setActive] = useState(0);
  return (
    <div className="login-shell">
      <section className="login-story">
        <a className="brand login-brand" href="#"><span className="brand-mark"><HeartPulse size={22} /></span><span className="brand-copy"><strong>medipilot<span>AI</span></strong><small>CARE, CONNECTED</small></span></a>
        <div className="story-content"><span className="story-pill"><Sparkles size={14} /> A more connected care journey</span><h1>Your health story,<br /><span>all in one place.</span></h1><p>Bring your care team, health records and next steps together — with thoughtful AI support along the way.</p><div className="story-points"><div><span><Check size={15} /></span> Your records, thoughtfully organized</div><div><span><Check size={15} /></span> Care decisions stay with your clinician</div><div><span><Check size={15} /></span> Privacy built into every step</div></div></div>
        <div className="story-footer"><ShieldCheck size={15} /> A private demo environment with synthetic data only</div>
        <div className="story-orb orb-one" /><div className="story-orb orb-two" />
      </section>
      <section className="login-panel">
        <div className="login-form-wrap"><div className="mobile-login-brand"><span className="brand-mark"><HeartPulse size={20} /></span><strong>medipilot<span>AI</span></strong></div>
          <div className="login-eyebrow">WELCOME TO MEDIPILOT</div><h2>Sign in to your workspace</h2><p className="login-subtitle">Choose a demo account to explore the experience.</p>
          <div className="account-picker" role="tablist" aria-label="Demo account type">
            {demoAccounts.map((account, index) => <button role="tab" aria-selected={active === index} className={active === index ? "selected" : ""} key={account.role} onClick={() => { setActive(index); setEmail(account.email); setPassword(account.password); }}><span>{account.label}</span></button>)}
          </div>
          <form className="login-form" onSubmit={(event) => { event.preventDefault(); onLogin(email, password); }}>
            <label>Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="button button-primary login-submit" disabled={busy}>{busy ? <span className="spinner" /> : <>Sign in securely <ArrowRight size={16} /></>}</button>
          </form>
          <div className="login-divider"><span>DEMO ACCESS</span></div>
          <div className="demo-credentials"><ShieldCheck size={16} /><span>Accounts use synthetic demo data. Never enter real patient information.</span></div>
          <p className="login-legal">By continuing, you agree to our <a href="#privacy">Privacy notice</a> and <a href="#terms">Terms of use</a>.</p>
        </div>
      </section>
    </div>
  );
}

function Overview({ user, go, setError }: { user: User; go: (page: Page) => void; setError: (error: string) => void }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [jobs, setJobs] = useState<OcrJob[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [analytics, setAnalytics] = useState<{ appointments: number; records: number; ocrJobs: number; patients: number; doctors: number } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const tasks: Promise<void>[] = [
      api<{ items: Appointment[] }>("/api/appointments").then((r) => setAppointments(r.items)),
      api<{ items: OcrJob[] }>("/api/ocr/jobs").then((r) => setJobs(r.items)),
      api<{ items: FollowUp[] }>("/api/follow-ups").then((r) => setFollowUps(r.items)),
    ];
    if (user.role === "PATIENT") tasks.push(api<{ items: RecordItem[] }>("/api/records").then((r) => setRecords(r.items)));
    if (user.role === "ADMIN") tasks.push(api<typeof analytics>("/api/admin/analytics").then((r) => setAnalytics(r)));
    Promise.all(tasks).catch((e) => setError((e as Error).message)).finally(() => setLoading(false));
  }, [user.role, setError]);
  const upcoming = appointments.filter((item) => item.status === "BOOKED");
  const sortedRecords = [...records].sort((a, b) => +new Date(b.recordedAt) - +new Date(a.recordedAt));

  if (user.role === "PATIENT") return (
    <div className="page-stack">
      <PageHeading eyebrow="YOUR HEALTH, IN FOCUS" title={greet(user.name)} description="A clear picture of your care, and what comes next." action={<button className="button button-primary" onClick={() => go("appointments")}><CalendarDays size={16} /> Book an appointment</button>} />
      <div className="welcome-banner"><div className="welcome-copy"><span className="welcome-kicker"><span className="live-dot" /> YOUR CARE AT A GLANCE</span><h2>Small steps make a healthier journey.</h2><p>Your health records and care team are right here when you need them.</p><button className="welcome-link" onClick={() => go("records")}>Explore your health timeline <ArrowRight size={15} /></button></div><div className="welcome-art"><div className="art-circle"><HeartPulse size={38} /></div><span className="art-bubble bubble-top"><CheckCircle2 size={15} /> Care, connected</span><span className="art-bubble bubble-bottom"><Activity size={15} /> Your next step</span></div></div>
      <div className="stats-grid">
        <StatCard icon={CalendarDays} label="Upcoming appointments" value={loading ? "—" : upcoming.length} change="Stay on top of your care" />
        <StatCard icon={FileHeart} label="Health records" value={loading ? "—" : records.length} change="Your timeline, in one place" accent="teal" />
        <StatCard icon={FileCheck2} label="Prescription scans" value={loading ? "—" : jobs.length} change={jobs.some((job) => job.status === "NEEDS_REVIEW") ? "Awaiting clinician review" : "Provider demo mode"} accent="violet" />
        <StatCard icon={ClipboardList} label="Care reminders" value={loading ? "—" : followUps.filter((item) => !item.completed).length} change="Gentle nudges, your way" accent="amber" />
      </div>
      <div className="content-grid patient-grid">
        <section className="panel"><SectionTitle title="Your next appointment" subtitle="A little preparation goes a long way." action={<button className="text-button" onClick={() => go("appointments")}>View all <ArrowRight size={14} /></button>} />
          {upcoming[0] ? <AppointmentCard item={upcoming[0]} role={user.role} /> : <EmptyState icon={CalendarDays} title="Nothing scheduled just yet" body="When you're ready, find a care team member and book a visit." />}
        </section>
        <section className="panel"><SectionTitle title="Recent health records" subtitle="Your care, organized by date." action={<button className="text-button" onClick={() => go("records")}>See timeline <ArrowRight size={14} /></button>} />
          {sortedRecords.slice(0, 3).map((record) => <RecordRow key={record.id} record={record} />)}
          {!loading && sortedRecords.length === 0 && <EmptyState icon={FileHeart} title="Your timeline starts here" body="Records shared with your care team will appear here." />}
        </section>
      </div>
      <section className="copilot-promo"><span className="promo-icon"><Sparkles size={20} /></span><div><strong>Questions about your records?</strong><p>Your health copilot helps explain what's documented — with sources you can check.</p></div><button className="button button-soft" onClick={() => go("copilot")}>Ask a question <ArrowRight size={15} /></button></section>
      <section className="panel"><SectionTitle title="Care reminders" subtitle="Follow-up actions shared by your care team." /><FollowUpList items={followUps} setError={setError} /></section>
    </div>
  );

  if (user.role === "DOCTOR") return (
    <div className="page-stack">
      <PageHeading eyebrow={user.department?.toUpperCase() ?? "CLINICAL WORKSPACE"} title={greet(user.name)} description="Here’s your team’s care at a glance." action={<button className="button button-primary" onClick={() => go("consultation")}><Stethoscope size={16} /> Open clinical workspace</button>} />
      <div className="stats-grid">
        <StatCard icon={CalendarDays} label="Scheduled appointments" value={loading ? "—" : upcoming.length} change="Your upcoming schedule" />
        <StatCard icon={Users} label="Connected patients" value={loading ? "—" : new Set(appointments.map((a) => a.patient.id)).size} change="Based on your care history" accent="teal" />
        <StatCard icon={FileCheck2} label="Awaiting review" value={loading ? "—" : jobs.filter((j) => j.status === "NEEDS_REVIEW").length} change="Human review always required" accent="amber" />
        <StatCard icon={ClipboardList} label="Follow-up reminders" value={loading ? "—" : followUps.filter((f) => !f.completed).length} change="Patient care plans" accent="violet" />
      </div>
      <div className="content-grid patient-grid">
        <section className="panel"><SectionTitle title="Your schedule" subtitle="Upcoming consultations." action={<button className="text-button" onClick={() => go("appointments")}>Full schedule <ArrowRight size={14} /></button>} />
          {upcoming.slice(0, 4).map((item) => <AppointmentCard item={item} role={user.role} key={item.id} />)}
          {!loading && upcoming.length === 0 && <EmptyState icon={CalendarDays} title="No upcoming appointments" body="New bookings will appear here." />}
        </section>
        <section className="panel"><SectionTitle title="Review queue" subtitle="OCR drafts that need your attention." action={<button className="text-button" onClick={() => go("verification")}>Review queue <ArrowRight size={14} /></button>} />
          {jobs.filter((job) => job.status === "NEEDS_REVIEW").slice(0, 3).map((job) => <OcrJobRow key={job.id} job={job} />)}
          {!loading && jobs.filter((job) => job.status === "NEEDS_REVIEW").length === 0 && <EmptyState icon={FileCheck2} title="Queue is clear" body="New prescription drafts will be listed when patients request review." />}
        </section>
      </div>
      <section className="copilot-promo"><span className="promo-icon"><Sparkles size={20} /></span><div><strong>Make the chart easier to review</strong><p>Create a source-linked summary from records you are authorized to access.</p></div><button className="button button-soft" onClick={() => go("consultation")}>Open copilot <ArrowRight size={15} /></button></section>
    </div>
  );

  return (
    <div className="page-stack">
      <PageHeading eyebrow="HOSPITAL OPERATIONS" title={greet(user.name)} description="A thoughtful view of how care is moving across your hospital." action={<button className="button button-primary" onClick={() => go("patients")}><Users size={16} /> Manage care team</button>} />
      <div className="stats-grid">
        <StatCard icon={CalendarDays} label="Total appointments" value={analytics?.appointments ?? "—"} change="Across the hospital" />
        <StatCard icon={Users} label="Registered patients" value={analytics?.patients ?? "—"} change="Synthetic demo accounts" accent="teal" />
        <StatCard icon={Stethoscope} label="Care team members" value={analytics?.doctors ?? "—"} change="Across departments" accent="violet" />
        <StatCard icon={FileCheck2} label="OCR review workload" value={analytics?.ocrJobs ?? "—"} change="Demo intake only" accent="amber" />
      </div>
      <div className="content-grid admin-grid">
        <section className="panel chart-panel"><SectionTitle title="Appointment activity" subtitle="Illustrative demo trend · not live operational reporting." action={<span className="chart-period">This week <ChevronDown size={14} /></span>} />
          <div className="chart-key"><span /><span>Appointments</span><strong>Steady care, every day</strong></div>
          <div className="chart-wrap"><Suspense fallback={<div className="loading-row">Loading analytics chart…</div>}><LazyAnalyticsChart data={chartData} gradientId="visitGradient" /></Suspense></div>
        </section>
        <section className="panel operations-panel"><SectionTitle title="Operational snapshot" subtitle="Seeded demonstration metrics." />
          <div className="operation-line"><span className="operation-dot green" /><span>Appointment service</span><strong>Demo data</strong></div>
          <div className="operation-line"><span className="operation-dot blue" /><span>OCR processing</span><strong>Human review</strong></div>
          <div className="operation-line"><span className="operation-dot amber" /><span>AI connections</span><strong>Not configured</strong></div>
          <div className="operation-note"><ShieldCheck size={16} /><span>Aggregate counts only. No medical record details are shown in this view.</span></div>
          <button className="button button-secondary operation-action" onClick={() => go("analytics")}>View analytics <ArrowRight size={15} /></button>
        </section>
      </div>
      <section className="panel"><SectionTitle title="A note on demo data" subtitle="MediPilot is running with synthetic records and provider adapters that are not connected to live services." /><div className="demo-banner"><span><Activity size={17} /></span><p>Analytics and charts in this workspace are illustrative only. Connect production systems and complete a privacy and security assessment before real clinical deployment.</p></div></section>
    </div>
  );
}
function greet(name: string) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return `${greeting}, ${name.startsWith("Dr.") ? name : name.split(" ")[0]}`;
}
function AppointmentCard({ item, role }: { item: Appointment; role: Role }) {
  const other = role === "PATIENT" ? item.doctor : item.patient;
  return <div className="appointment-card"><div className="appointment-date"><strong>{dateLabel(item.startsAt, { day: "2-digit" })}</strong><span>{dateLabel(item.startsAt, { month: "short" })}</span></div><div className="appointment-info"><strong>{other.name}</strong><span>{role === "PATIENT" ? (item.doctor.specialty ?? "Care team") : item.reason}</span><small><Clock3 size={12} /> {timeLabel(item.startsAt)} · {item.reason}</small></div><span className="status-pill status-booked">{item.status.toLowerCase()}</span></div>;
}
function RecordRow({ record }: { record: RecordItem }) {
  const colors: Record<string, string> = { "Consultation": "record-blue", "Lab report": "record-teal", "Prescription": "record-purple" };
  return <div className="record-row"><span className={`record-type ${colors[record.category] ?? "record-blue"}`}><FileHeart size={16} /></span><div className="record-info"><strong>{record.title}</strong><span>{record.category}</span></div><time>{dateLabel(record.recordedAt)}</time></div>;
}
function OcrJobRow({ job }: { job: OcrJob }) {
  return <div className="ocr-row"><span className="ocr-icon"><FileCheck2 size={16} /></span><div className="ocr-info"><strong>{job.fileName}</strong><span>Patient-uploaded · demo extraction</span></div><span className="status-pill status-review">Needs review</span></div>;
}

function Appointments({ user, setError, setNotice }: { user: User; setError: (error: string) => void; setNotice: (notice: string) => void }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const canBook = user.role === "PATIENT";
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        api<{ items: Appointment[] }>("/api/appointments"),
        ...(canBook ? [api<{ items: Doctor[] }>("/api/doctors")] : []),
      ]);
      setAppointments(results[0].items);
      if (canBook && "items" in results[1]) { setDoctors(results[1].items); setDoctorId((current) => current || results[1].items[0]?.id || ""); }
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [canBook, setError]);
  useEffect(() => { void load(); }, [load]);
  async function book(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api("/api/appointments", { method: "POST", body: JSON.stringify({ doctorId, startsAt: new Date(startsAt).toISOString(), reason }) });
      setReason(""); setStartsAt(""); setNotice("Your appointment is booked. Your care team can now see it."); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const today = new Date().toISOString().slice(0, 10);
  return <div className="page-stack">
    <PageHeading eyebrow={canBook ? "YOUR CARE, ON YOUR SCHEDULE" : "YOUR CARE TEAM"} title="Appointments" description={canBook ? "Find a time that works and keep your care journey moving." : "Your upcoming consultations and recent visits."} action={canBook && <span className="secure-label"><ShieldCheck size={15} /> Secure booking</span>} />
    <div className="content-grid appointment-layout">
      {canBook && <section className="panel booking-panel"><SectionTitle title="Find a time to meet" subtitle="Choose a care team member and a time that works for you." />
        <form onSubmit={(event) => void book(event)} className="stacked-form">
          <label>Care team member<select value={doctorId} onChange={(event) => setDoctorId(event.target.value)} required><option value="" disabled>Select a doctor</option>{doctors.map((doctor) => <option value={doctor.id} key={doctor.id}>{doctor.name} · {doctor.specialty ?? doctor.department ?? "Care team"}</option>)}</select></label>
          <label>Preferred date and time<input type="datetime-local" min={`${today}T08:00`} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label>
          <label>What would you like to discuss?<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="A short note for your care team" rows={3} maxLength={240} required /></label>
          <button className="button button-primary full-width" disabled={busy || !doctors.length}>{busy ? <span className="spinner" /> : <>Request this appointment <ArrowRight size={16} /></>}</button>
          <p className="form-hint"><ShieldCheck size={13} /> Your details are only shared with the selected care team.</p>
        </form>
      </section>}
      <section className="panel"><SectionTitle title={canBook ? "Your appointments" : "Schedule"} subtitle="Booked visits and care milestones." />
        {loading && <div className="loading-row"><span className="spinner spinner-dark" /> Loading your schedule…</div>}
        {!loading && appointments.filter((appointment) => appointment.status === "BOOKED").length === 0 && <EmptyState icon={CalendarDays} title="No upcoming appointments" body={canBook ? "Choose a care team member to schedule your first visit." : "New bookings will appear here."} />}
        {appointments.filter((appointment) => appointment.status === "BOOKED").map((item) => <AppointmentCard item={item} role={user.role} key={item.id} />)}
        {appointments.some((appointment) => appointment.status !== "BOOKED") && <><div className="history-divider">PAST VISITS</div>{appointments.filter((appointment) => appointment.status !== "BOOKED").map((item) => <AppointmentCard item={item} role={user.role} key={item.id} />)}</>}
      </section>
    </div>
    <div className="callout-neutral"><ShieldCheck size={17} /><span>Need to change a confirmed appointment? Please contact your care team so they can help you find the right time.</span></div>
  </div>;
}

function Records({ setError }: { setError: (error: string) => void }) {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      api<{ items: RecordItem[] }>("/api/records"),
      api<{ items: Prescription[] }>("/api/prescriptions"),
    ]).then(([recordResult, prescriptionResult]) => {
      setRecords(recordResult.items);
      setPrescriptions(prescriptionResult.items);
    }).catch((e) => setError((e as Error).message)).finally(() => setLoading(false));
  }, [setError]);
  const years = useMemo(() => Array.from(new Set(records.map((record) => new Date(record.recordedAt).getFullYear()))), [records]);
  return <div className="page-stack">
    <PageHeading eyebrow="YOUR HEALTH JOURNEY" title="My health records" description="A clearer view of the records shared with your care team." action={<span className="secure-label"><ShieldCheck size={15} /> Only you and your care team</span>} />
    <div className="record-summary-strip"><span className="record-summary-icon"><FileHeart size={19} /></span><div><strong>Your timeline, thoughtfully organized</strong><p>These are the records available to you. For questions about missing or incorrect information, please contact your care team.</p></div><span className="record-summary-count">{records.length} records</span></div>
    {loading && <div className="loading-row"><span className="spinner spinner-dark" /> Loading your health records…</div>}
    {!loading && !records.length && <section className="panel"><EmptyState icon={FileHeart} title="Your health timeline is ready" body="Records shared with your care team will appear here." /></section>}
    {years.map((year) => <section className="timeline-section" key={year}><div className="timeline-year">{year}<span>{records.filter((record) => new Date(record.recordedAt).getFullYear() === year).length} items</span></div><div className="timeline-list">{records.filter((record) => new Date(record.recordedAt).getFullYear() === year).map((record, index) => <article className="timeline-item" key={record.id}><div className="timeline-marker"><span className={`record-type ${index % 2 ? "record-teal" : "record-blue"}`}><FileHeart size={16} /></span></div><div className="timeline-card"><div className="timeline-meta"><span>{record.category}</span><time>{dateLabel(record.recordedAt, { month: "long", day: "numeric" })}</time></div><h3>{record.title}</h3><p>{record.summary}</p><div className="record-source"><ShieldCheck size={13} /> Shared by your care team</div></div></article>)}</div></section>)}
    {prescriptions.length > 0 && <section className="panel prescription-panel"><SectionTitle title="Clinician-finalized prescriptions" subtitle="Medication details recorded by your doctor." />
      {prescriptions.map((prescription) => <article className="prescription-card" key={prescription.id}><div className="prescription-card-head"><span className="record-type record-purple"><FileCheck2 size={16} /></span><div><strong>{prescription.title}</strong><small>Finalized {dateLabel(prescription.finalizedAt, { month: "short", day: "numeric", year: "numeric" })}</small></div><span className="status-pill status-verified">Clinician recorded</span></div>{prescription.items.map((item, index) => <div className="medication-line" key={`${item.medicine}-${index}`}><strong>{item.medicine}{item.strength ? ` · ${item.strength}` : ""}</strong><span>{item.dosage} · {item.frequency}{item.duration ? ` · ${item.duration}` : ""}</span>{item.instructions && <small>{item.instructions}</small>}</div>)}</article>)}
    </section>}
    <div className="callout-neutral"><ShieldCheck size={17} /><span>Your records contain private health information. This demo uses synthetic data only — please don't upload real medical documents.</span></div>
  </div>;
}

function OcrPatient({ setError, setNotice }: { setError: (error: string) => void; setNotice: (notice: string) => void }) {
  const [jobs, setJobs] = useState<OcrJob[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { const result = await api<{ items: OcrJob[] }>("/api/ocr/jobs"); setJobs(result.items); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError("");
    try {
      const body = new FormData(); body.append("document", file);
      const result = await api<{ message: string }>("/api/ocr/jobs/upload", { method: "POST", body, headers: { "Idempotency-Key": crypto.randomUUID() } });
      setFile(null); setNotice(result.message); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="page-stack">
    <PageHeading eyebrow="PRESCRIPTION INTAKE" title="Prescription scan" description="Organize a prescription draft for review by your care team." action={<span className="demo-badge"><span /> DEMO OCR</span>} />
    <div className="ocr-disclaimer"><span className="disclaimer-icon"><ShieldCheck size={19} /></span><div><strong>Patient corrections are never clinical verification.</strong><p>This demo securely stores your original privately, but no OCR provider is connected. No fields are extracted or verified until a clinician reviews them.</p></div></div>
    <div className="content-grid ocr-upload-layout">
      <section className="panel upload-panel"><SectionTitle title="Add a prescription" subtitle="Your document is stored privately and only available to authorized reviewers." />
        <form onSubmit={(event) => void submit(event)}>
          <label className={`dropzone ${file ? "file-selected" : ""}`} htmlFor="prescription-file"><input id="prescription-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <span className="upload-icon"><UploadCloud size={23} /></span><strong>{file ? file.name : "Choose a document or take a photo"}</strong><span>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.type || "unknown type"}` : "JPEG, PNG, WebP or PDF · up to 8 MB"}</span><span className="button button-secondary upload-choose">{file ? "Change document" : "Browse files"}</span>
          </label>
          {file && <div className="selected-file"><FilePlus2 size={15} /><span>Ready for secure demo intake</span><button type="button" onClick={() => setFile(null)} aria-label="Remove selected document"><X size={15} /></button></div>}
          <button className="button button-primary full-width" disabled={!file || busy}>{busy ? <span className="spinner" /> : <>Securely add for clinician review <ArrowRight size={16} /></>}</button>
          <p className="form-hint"><ShieldCheck size={13} /> Your original document is private and not publicly accessible.</p>
        </form>
      </section>
      <section className="panel processing-panel"><SectionTitle title="How your review works" subtitle="A clear path from upload to clinician-reviewed record." />
        <div className="process-steps">{[
          ["01", "Private upload", "The original is stored in a private, access-controlled folder."],
          ["02", "Text extraction", "A configured OCR provider can extract a draft; this demo is not connected."],
          ["03", "Clinician review", "An authorized clinician checks every field before approval."],
          ["04", "Verified record", "Only reviewed information joins your health timeline."],
        ].map(([number, title, text], index) => <div className="process-step" key={number}><span className={`step-number ${index === 2 ? "step-current" : ""}`}>{index < 2 ? <Check size={14} /> : number}</span><div><strong>{title}</strong><span>{text}</span></div></div>)}</div>
      </section>
    </div>
    <section className="panel"><SectionTitle title="Your submitted documents" subtitle="Extraction drafts are not prescriptions and are not clinically verified." />
      {loading && <div className="loading-row"><span className="spinner spinner-dark" /> Loading documents…</div>}
      {!loading && jobs.length === 0 && <EmptyState icon={FilePlus2} title="No documents yet" body="Your submitted prescription drafts will appear here." />}
      {jobs.map((job) => <div className="document-list-row" key={job.id}><span className="ocr-icon"><FileHeart size={17} /></span><div className="ocr-info"><strong>{job.fileName}</strong><span>Added {dateLabel(job.createdAt, { month: "short", day: "numeric", year: "numeric" })} · {job.demo ? "Demo extraction" : "OCR extraction"}</span></div><span className={`status-pill ${job.status === "VERIFIED" ? "status-verified" : job.status === "REJECTED" ? "status-rejected" : "status-review"}`}>{job.status.replace("_", " ").toLowerCase()}</span></div>)}
    </section>
  </div>;
}

function Copilot({ setError }: { setError: (error: string) => void }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{ question: string; answer: string; sources: { id: string; title: string; category: string; date: string }[] }[]>([]);
  const [busy, setBusy] = useState(false);
  async function ask(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<{ answer: string; sources: { id: string; title: string; category: string; date: string }[] }>("/api/ai/patient-copilot", { method: "POST", body: JSON.stringify({ question }) });
      setMessages((current) => [...current, { question, ...result }]); setQuestion("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const suggestions = ["What records are in my timeline?", "Can you explain my latest report?", "What should I ask at my next visit?"];
  return <div className="page-stack">
    <PageHeading eyebrow="A HELPFUL PLACE TO START" title="Health copilot" description="Understand what's written in your records, in everyday language." action={<span className="demo-badge"><span /> RECORD-GROUNDED DEMO</span>} />
    <div className="copilot-safety"><ShieldCheck size={17} /><span>Your copilot can only refer to records you are authorized to see. It doesn't diagnose, prescribe or change your care.</span></div>
    <section className="copilot-chat panel">
      <div className="chat-header"><span className="chat-avatar"><Sparkles size={19} /></span><div><strong>Your health copilot</strong><span><i /> Available to explain your records</span></div><span className="grounded-tag"><ShieldCheck size={13} /> Sources included</span></div>
      <div className="chat-messages">
        <div className="assistant-message"><span className="assistant-mark"><Sparkles size={14} /></span><div><p>Hi, Alex. I can help explain information that appears in your health records. I’ll show you which records I used, and I’ll let you know if something isn’t available.</p><small>Based only on your authorized records · Not medical advice</small></div></div>
        {messages.map((message, index) => <div className="message-thread" key={`${index}-${message.question}`}><div className="user-message">{message.question}</div><div className="assistant-message"><span className="assistant-mark"><Sparkles size={14} /></span><div><p>{message.answer}</p><small>Demo response · No external AI provider connected</small>{message.sources.length > 0 && <div className="source-list"><strong>Records checked</strong>{message.sources.map((source) => <span key={source.id}><FileHeart size={13} /> {source.title} <small>{source.category} · {dateLabel(source.date)}</small></span>)}</div>}</div></div></div>)}
        {!messages.length && <div className="suggestion-wrap"><span>TRY ASKING</span><div>{suggestions.map((suggestion) => <button type="button" onClick={() => setQuestion(suggestion)} key={suggestion}>{suggestion} <ArrowUpRight size={13} /></button>)}</div></div>}
      </div>
      <form className="chat-compose" onSubmit={(event) => void ask(event)}><label className="sr-only" htmlFor="copilot-question">Ask a question about your records</label><input id="copilot-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about something in your health records…" maxLength={1000} required /><button className="button button-primary" disabled={busy || !question.trim()}>{busy ? <span className="spinner" /> : <>Send <ArrowRight size={15} /></>}</button></form>
      <div className="chat-footnote"><ShieldCheck size={13} /> Your conversation is private. For urgent symptoms, contact your local emergency service or care team.</div>
    </section>
  </div>;
}

function Patients({ user, setError }: { user: User; setError: (error: string) => void }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", specialty: "" });
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const [appointmentsResponse, doctorResponse] = await Promise.all([
        api<{ items: Appointment[] }>("/api/appointments"),
        ...(user.role === "ADMIN" ? [api<{ items: Doctor[] }>("/api/doctors")] : []),
      ]);
      setAppointments(appointmentsResponse.items);
      if (user.role === "ADMIN" && "items" in doctorResponse) setDoctors(doctorResponse.items);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [user.role, setError]);
  useEffect(() => { void load(); }, [load]);
  const patients = useMemo(() => {
    const map = new Map<string, Appointment["patient"]>();
    appointments.forEach((item) => map.set(item.patient.id, item.patient));
    return Array.from(map.values()).filter((patient) => patient.name.toLowerCase().includes(query.toLowerCase()));
  }, [appointments, query]);
  async function createDoctor(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/api/admin/doctors", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", email: "", password: "", specialty: "" }); setShowForm(false); setNotice("Doctor account created successfully."); await load();
    } catch (e) { setError((e as Error).message); }
  }
  return <div className="page-stack">
    <PageHeading eyebrow={user.role === "ADMIN" ? "HOSPITAL DIRECTORY" : "YOUR CONNECTED CARE"} title={user.role === "ADMIN" ? "Care team" : "My patients"} description={user.role === "ADMIN" ? "Manage demo clinician accounts and departments." : "Patients linked to your appointments and documented care."} action={user.role === "ADMIN" && <button className="button button-primary" onClick={() => setShowForm(!showForm)}><Users size={16} /> {showForm ? "Close form" : "Add a doctor"}</button>} />
    {notice && <div className="alert alert-success" role="status"><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={16} /></button></div>}
    {showForm && user.role === "ADMIN" && <section className="panel"><SectionTitle title="Create a clinician account" subtitle="Use a unique email and a strong initial password." /><form className="inline-form" onSubmit={(event) => void createDoctor(event)}><label>Full name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} /></label><label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label><label>Department / specialty<input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} required /></label><label>Temporary password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={12} /></label><button className="button button-primary">Create clinician</button></form></section>}
    {user.role === "DOCTOR" ? <section className="panel"><SectionTitle title="Patients connected through your care" subtitle="Access is limited to patients linked by an appointment or existing clinical record." action={<div className="table-search"><Search size={15} /><input aria-label="Search patients" placeholder="Search patients" value={query} onChange={(event) => setQuery(event.target.value)} /></div>} />
      {loading && <div className="loading-row"><span className="spinner spinner-dark" /> Loading connected patients…</div>}
      {!loading && patients.length === 0 && <EmptyState icon={Users} title="No connected patients yet" body="Patients with a booked appointment will appear here." />}
      {patients.map((patient) => <div className="directory-row" key={patient.id}><Avatar name={patient.name} /><div className="directory-main"><strong>{patient.name}</strong><span>Connected through your care</span></div><span className="directory-access"><ShieldCheck size={14} /> Authorized</span></div>)}
    </section> : <section className="panel"><SectionTitle title="Clinical team" subtitle="Synthetic demo accounts for this workspace." />
      {loading && <div className="loading-row"><span className="spinner spinner-dark" /> Loading care team…</div>}
      {doctors.map((doctor) => <div className="directory-row" key={doctor.id}><Avatar name={doctor.name} /><div className="directory-main"><strong>{doctor.name}</strong><span>{doctor.specialty ?? doctor.department ?? "Care team"} · {doctor.department ?? "MediPilot Hospital"}</span></div><span className="team-status"><i /> Active</span></div>)}
    </section>}
    <div className="callout-neutral"><ShieldCheck size={17} /><span>Access to medical records is checked by the server for every request. Changing a patient ID in a URL does not grant permission.</span></div>
  </div>;
}

function Verification({ setError, setNotice }: { setError: (error: string) => void; setNotice: (notice: string) => void }) {
  const [jobs, setJobs] = useState<OcrJob[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<OcrJob["fields"]>([]);
  const load = useCallback(async () => {
    try {
      const result = await api<{ items: OcrJob[] }>("/api/ocr/jobs");
      setJobs(result.items); setSelectedId((current) => current || result.items.find((item) => item.status === "NEEDS_REVIEW")?.id || "");
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  const selected = jobs.find((job) => job.id === selectedId);
  useEffect(() => { if (selected) setFields(selected.fields ?? []); }, [selectedId, selected]);
  async function review(decision: "verify" | "reject") {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      await api(`/api/ocr/jobs/${selected.id}/review`, { method: "POST", body: JSON.stringify({ decision }) });
      setNotice(decision === "verify" ? "Clinician verification recorded with an audit event." : "Extraction rejected and recorded in the audit trail.");
      setSelectedId(""); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="page-stack">
    <PageHeading eyebrow="HUMAN-IN-THE-LOOP REVIEW" title="Prescription review" description="Review the original document and draft fields before recording any clinical decision." action={<span className="demo-badge"><span /> {jobs.filter((job) => job.status === "NEEDS_REVIEW").length} TO REVIEW</span>} />
    <div className="ocr-disclaimer"><span className="disclaimer-icon"><ShieldCheck size={19} /></span><div><strong>OCR draft is not clinical truth.</strong><p>Demo OCR does not extract or guess values. Verification records who reviewed the document; it does not establish authenticity or independently prescribe treatment.</p></div></div>
    {loading && <div className="loading-row"><span className="spinner spinner-dark" /> Loading your authorized review queue…</div>}
    {!loading && jobs.length === 0 && <section className="panel"><EmptyState icon={FileCheck2} title="No review items" body="Patient-uploaded documents from your connected patients will appear here." /></section>}
    {!loading && jobs.length > 0 && <div className="verification-layout">
      <section className="panel verification-document"><SectionTitle title="Original document" subtitle={selected?.fileName ?? "Select a review item"} />
        <div className="document-viewer">{selected ? <iframe title={`Private original document ${selected.fileName}`} src={`/api/ocr/jobs/${selected.id}/file`} /> : <EmptyState icon={FileCheck2} title="Select a document" body="Choose an item from the queue to begin review." />}</div>
        <div className="viewer-footnote"><ShieldCheck size={13} /> Private, access-controlled original · {selected?.mimeType ?? "No document selected"}</div>
      </section>
      <section className="panel verification-fields"><SectionTitle title="Extracted draft" subtitle={selected ? `Uploaded ${dateLabel(selected.createdAt, { month: "short", day: "numeric", year: "numeric" })}` : "Select a review item"} />
        {jobs.filter((job) => job.status === "NEEDS_REVIEW").length > 0 && <div className="review-queue">{jobs.filter((job) => job.status === "NEEDS_REVIEW").map((job) => <button className={`queue-item ${selectedId === job.id ? "queue-selected" : ""}`} onClick={() => setSelectedId(job.id)} key={job.id}><span className="ocr-icon"><FileHeart size={15} /></span><span><strong>{job.fileName}</strong><small>Demo extraction · needs review</small></span><ArrowRight size={14} /></button>)}</div>}
        {selected && <><div className="demo-review-label"><span /> DEMO · NO TEXT EXTRACTED</div><p className="verification-note">Fields below are intentionally blank. Review the original manually; never infer missing values.</p>
          {fields.map((field, index) => <label className="ocr-field" key={field.name}><span className="ocr-field-head"><strong>{field.name.charAt(0).toUpperCase() + field.name.slice(1)}</strong><span className="confidence-chip confidence-none">{field.state.replace("_", " ")}</span></span><input value={field.value ?? ""} placeholder="Not found in demo extraction" onChange={(event) => setFields((current) => current.map((entry, i) => i === index ? { ...entry, value: event.target.value || null, state: event.target.value ? "needs_review" : "not_detected" } : entry))} /><select aria-label={`${field.name} review status`} value={field.state} onChange={(event) => setFields((current) => current.map((entry, i) => i === index ? { ...entry, state: event.target.value } : entry))}><option value="not_detected">Not reviewed</option><option value="verified">Verified from original</option><option value="not_found">Not present</option><option value="unreadable">Unreadable</option></select><small>Source text: not available · no value has been guessed</small></label>)}
          {selected.status === "NEEDS_REVIEW" && <div className="review-actions"><button className="button button-danger-soft" disabled={busy} onClick={() => void review("reject")}><X size={15} /> Reject draft</button><button className="button button-primary" disabled={busy} onClick={() => void review("verify")}><Check size={15} /> Record verification</button></div>}
          {selected.status !== "NEEDS_REVIEW" && <div className="callout-neutral"><CheckCircle2 size={16} /> This item is {selected.status.toLowerCase()}.</div>}
        </>}
        {!jobs.some((job) => job.status === "NEEDS_REVIEW") && <EmptyState icon={CheckCircle2} title="Review queue is clear" body="There are no drafts waiting for review." />}
      </section>
    </div>}
  </div>;
}

function Consultation({ setError, setNotice }: { setError: (error: string) => void; setNotice: (notice: string) => void }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [summary, setSummary] = useState("");
  const [title, setTitle] = useState("Clinical consultation note");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<{ id: string; title: string; category: string; date: string }[]>([]);
  const [disclaimer, setDisclaimer] = useState("");
  const [medication, setMedication] = useState({ medicine: "", strength: "", dosage: "", frequency: "", duration: "", instructions: "" });
  const [followUp, setFollowUp] = useState({ title: "", dueAt: "" });
  useEffect(() => {
    api<{ items: Appointment[] }>("/api/appointments").then((result) => {
      setAppointments(result.items); setSelectedId(result.items[0]?.patient.id ?? "");
    }).catch((e) => setError((e as Error).message)).finally(() => setLoading(false));
  }, [setError]);
  const patients = useMemo(() => Array.from(new Map(appointments.map((item) => [item.patient.id, item.patient])).values()), [appointments]);
  async function generate() {
    if (!selectedId) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ summary: string; sources: typeof sources; disclaimer: string }>("/api/ai/clinical-copilot", { method: "POST", body: JSON.stringify({ patientId: selectedId }) });
      setSummary(result.summary); setSources(result.sources); setDisclaimer(result.disclaimer);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function saveNote(event: React.FormEvent) {
    event.preventDefault(); if (!selectedId) return;
    setBusy(true); setError("");
    try {
      await api("/api/consultations", { method: "POST", body: JSON.stringify({ patientId: selectedId, title, summary }) });
      setNotice("Consultation note saved to the patient's record."); setSummary(""); setSources([]); setDisclaimer("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function finalizePrescription(event: React.FormEvent) {
    event.preventDefault(); if (!selectedId) return;
    setBusy(true); setError("");
    try {
      await api("/api/prescriptions", { method: "POST", body: JSON.stringify({
        patientId: selectedId, title: "Prescription",
        items: [{ ...medication, strength: medication.strength || null, duration: medication.duration || null, instructions: medication.instructions || null }],
      }) });
      setMedication({ medicine: "", strength: "", dosage: "", frequency: "", duration: "", instructions: "" });
      setNotice("Prescription finalized by you and added to the patient's health record.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function createFollowUp(event: React.FormEvent) {
    event.preventDefault(); if (!selectedId) return;
    setBusy(true); setError("");
    try {
      await api("/api/follow-ups", { method: "POST", body: JSON.stringify({ patientId: selectedId, title: followUp.title, dueAt: new Date(followUp.dueAt).toISOString() }) });
      setFollowUp({ title: "", dueAt: "" }); setNotice("Follow-up reminder added to the patient's care plan.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="page-stack">
    <PageHeading eyebrow="CLINICIAN-LED DOCUMENTATION" title="Clinical workspace" description="Review authorized records, prepare a source-linked summary, and save a note you have reviewed." action={<span className="secure-label"><ShieldCheck size={15} /> Clinician review required</span>} />
    <div className="clinical-toolbar panel"><label>Patient<select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setSummary(""); setSources([]); }}><option value="">Choose a connected patient</option>{patients.map((patient) => <option value={patient.id} key={patient.id}>{patient.name}</option>)}</select></label><button className="button button-soft" onClick={() => void generate()} disabled={!selectedId || busy}>{busy ? <span className="spinner spinner-dark" /> : <Sparkles size={16} />} Generate chart summary</button></div>
    {loading && <div className="loading-row"><span className="spinner spinner-dark" /> Loading your connected patients…</div>}
    {!loading && !patients.length && <section className="panel"><EmptyState icon={Users} title="No connected patients" body="A booked appointment will establish an authorized connection." /></section>}
    {selectedId && <div className="content-grid clinical-layout">
      <section className="panel clinical-summary"><SectionTitle title="Source-grounded chart summary" subtitle="Only records retrieved for the selected, authorized patient are shown." />
        {summary ? <><div className="ai-generated-label"><Sparkles size={14} /> AI-ASSISTED DEMO SUMMARY · REVIEW BEFORE USE</div><div className="summary-content">{summary}</div><div className="source-list clinical-sources"><strong>Sources</strong>{sources.length ? sources.map((source) => <span key={source.id}><FileHeart size={13} /> {source.title} <small>{source.category} · {dateLabel(source.date)}</small></span>) : <span>No source records were found. No history has been inferred.</span>}</div><div className="callout-neutral"><ShieldCheck size={16} />{disclaimer}</div></> : <EmptyState icon={Sparkles} title="Your review starts with the record" body="Generate a summary to retrieve documented sources. Missing details will stay missing." />}
      </section>
      <section className="panel note-panel"><SectionTitle title="Consultation note" subtitle="You review and decide what becomes part of the record." />
        <form onSubmit={(event) => void saveNote(event)} className="stacked-form"><label>Note title<input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} maxLength={160} /></label><label>Clinical documentation<textarea className="note-editor" value={summary} onChange={(event) => setSummary(event.target.value)} rows={12} required minLength={3} maxLength={5000} placeholder="Document your own reviewed clinical findings and plan…" /></label><p className="form-hint">Saving creates a dated consultation record. Confirm all clinical content yourself.</p><button className="button button-primary full-width" disabled={busy || !summary.trim()}><FilePlus2 size={16} /> Save reviewed note</button></form>
        <div className="clinical-divider">DOCTOR-ENTERED PRESCRIPTION</div>
        <form onSubmit={(event) => void finalizePrescription(event)} className="stacked-form">
          <label>Medicine name<input value={medication.medicine} onChange={(e) => setMedication({ ...medication, medicine: e.target.value })} maxLength={160} required /></label>
          <div className="form-row"><label>Strength<input value={medication.strength} onChange={(e) => setMedication({ ...medication, strength: e.target.value })} placeholder="Only if specified" maxLength={80} /></label><label>Dosage<input value={medication.dosage} onChange={(e) => setMedication({ ...medication, dosage: e.target.value })} required placeholder="Doctor-entered" maxLength={180} /></label></div>
          <div className="form-row"><label>Frequency<input value={medication.frequency} onChange={(e) => setMedication({ ...medication, frequency: e.target.value })} required placeholder="Doctor-entered" maxLength={160} /></label><label>Duration<input value={medication.duration} onChange={(e) => setMedication({ ...medication, duration: e.target.value })} placeholder="Only if specified" maxLength={100} /></label></div>
          <label>Special instructions<input value={medication.instructions} onChange={(e) => setMedication({ ...medication, instructions: e.target.value })} maxLength={300} /></label>
          <p className="form-hint"><ShieldCheck size={13} /> Explicitly confirm all details. This does not infer dosage or duration.</p>
          <button className="button button-secondary full-width" disabled={busy || !selectedId}><FileCheck2 size={15} /> Finalize prescription</button>
        </form>
        <div className="clinical-divider">FOLLOW-UP CARE</div>
        <form onSubmit={(event) => void createFollowUp(event)} className="stacked-form">
          <label>Reminder for your patient<input value={followUp.title} onChange={(e) => setFollowUp({ ...followUp, title: e.target.value })} maxLength={180} required placeholder="A reminder for the next step" /></label>
          <label>Due date and time<input type="datetime-local" value={followUp.dueAt} onChange={(e) => setFollowUp({ ...followUp, dueAt: e.target.value })} required /></label>
          <button className="button button-soft full-width" disabled={busy || !selectedId}><CalendarDays size={15} /> Add patient reminder</button>
        </form>
      </section>
    </div>}
  </div>;
}

function FollowUpList({ items, setError }: { items: FollowUp[]; setError: (error: string) => void }) {
  const [followUps, setFollowUps] = useState(items);
  useEffect(() => setFollowUps(items), [items]);
  async function toggle(item: FollowUp) {
    try {
      const result = await api<{ item: FollowUp }>(`/api/follow-ups/${item.id}`, { method: "PATCH", body: JSON.stringify({ completed: !item.completed }) });
      setFollowUps((current) => current.map((followUp) => followUp.id === item.id ? result.item : followUp));
    } catch (e) { setError((e as Error).message); }
  }
  if (!followUps.length) return <EmptyState icon={ClipboardList} title="No follow-up reminders" body="Your care team can add a reminder after a visit." />;
  return <div className="followup-list">{followUps.map((item) => <div className={`followup-row ${item.completed ? "followup-complete" : ""}`} key={item.id}><span className="followup-icon">{item.completed ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}</span><div><strong>{item.title}</strong><span>{dateLabel(item.dueAt, { month: "short", day: "numeric", year: "numeric" })} · {item.completed ? "Completed" : "Upcoming"}</span></div><button className={`button ${item.completed ? "button-secondary" : "button-soft"}`} onClick={() => void toggle(item)}>{item.completed ? "Mark incomplete" : "Mark done"}</button></div>)}</div>;
}

function Analytics({ setError }: { setError: (error: string) => void }) {
  const [data, setData] = useState<{ appointments: number; records: number; ocrJobs: number; patients: number; doctors: number; demoData: boolean } | null>(null);
  useEffect(() => { api<typeof data>("/api/admin/analytics").then(setData).catch((e) => setError((e as Error).message)); }, [setError]);
  return <div className="page-stack">
    <PageHeading eyebrow="AGGREGATE OPERATIONS" title="Operations analytics" description="High-level activity to help hospital teams understand how care is flowing." action={<span className="demo-badge"><span /> SYNTHETIC DEMO DATA</span>} />
    <div className="stats-grid">
      <StatCard icon={CalendarDays} label="Appointments recorded" value={data?.appointments ?? "—"} accent="blue" />
      <StatCard icon={Users} label="Synthetic patient accounts" value={data?.patients ?? "—"} accent="teal" />
      <StatCard icon={Stethoscope} label="Clinician accounts" value={data?.doctors ?? "—"} accent="violet" />
      <StatCard icon={FileCheck2} label="Prescription intakes" value={data?.ocrJobs ?? "—"} accent="amber" />
    </div>
    <div className="content-grid analytics-grid">
      <section className="panel chart-panel"><SectionTitle title="Illustrative weekly activity" subtitle="A visual example only — not derived from live appointment records." /><div className="chart-wrap analytics-chart"><Suspense fallback={<div className="loading-row">Loading analytics chart…</div>}><LazyAnalyticsChart data={chartData} gradientId="analyticsGradient" /></Suspense></div></section>
      <section className="panel"><SectionTitle title="Service configuration" subtitle="Provider readiness at a glance." />
        <div className="config-row"><span className="config-icon config-green"><ShieldCheck size={16} /></span><div><strong>Authentication</strong><span>HttpOnly, same-site sessions</span></div><span className="config-state">Active</span></div>
        <div className="config-row"><span className="config-icon config-blue"><FileCheck2 size={16} /></span><div><strong>OCR provider</strong><span>Private demo intake only</span></div><span className="config-state state-neutral">Demo</span></div>
        <div className="config-row"><span className="config-icon config-amber"><Sparkles size={16} /></span><div><strong>AI provider</strong><span>Not configured</span></div><span className="config-state state-neutral">Offline</span></div>
        <div className="analytics-total"><strong>{data?.records ?? "—"}</strong><span>synthetic health records</span></div>
      </section>
    </div>
    <div className="callout-neutral"><ShieldCheck size={17} /><span>Charts and service metrics are for product demonstration only. OCR accuracy is not claimed, and no performance statistics are based on an evaluated clinical dataset.</span></div>
  </div>;
}
