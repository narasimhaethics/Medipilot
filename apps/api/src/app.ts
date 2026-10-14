import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import "express-async-errors";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { MulterError } from "multer";
import { z } from "zod";
import { AppointmentStatus, OcrStatus, Role, type OcrJob } from "@prisma/client";
import { prisma } from "./db.js";
import { allowRoles, audit, authenticate, canAccessPatient, createSession } from "./auth.js";

const app = express();
const uploadDirectory = path.resolve(process.env.UPLOAD_DIRECTORY ?? "private-uploads");
const uploadLimitBytes = Number(process.env.MAX_UPLOAD_MB ?? 8) * 1024 * 1024;
app.disable("x-powered-by");
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
if (process.env.NODE_ENV === "production") {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32 || secret.includes("replace-with") || secret === "development-only-secret") {
    throw new Error("Set a unique SESSION_SECRET with at least 32 characters in production.");
  }
  if (!process.env.DATABASE_URL?.startsWith("postgresql://") && !process.env.DATABASE_URL?.startsWith("postgres://")) {
    throw new Error("Production requires PostgreSQL; configure its DATABASE_URL and generate the PostgreSQL Prisma client.");
  }
  if (!process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS.split(",").some((origin) => !origin.trim() || /localhost|127\.0\.0\.1/.test(origin))) {
    throw new Error("Production requires an explicit ALLOWED_ORIGINS list for deployed web origins.");
  }
}
if (!Number.isFinite(uploadLimitBytes) || uploadLimitBytes <= 0 || uploadLimitBytes > 25 * 1024 * 1024) {
  throw new Error("MAX_UPLOAD_MB must be greater than zero and no more than 25 MB.");
}
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-origin" }, hsts: process.env.NODE_ENV === "production" ? undefined : false }));
app.use((req, res, next) => {
  if (process.env.NODE_ENV === "production" && !req.secure) {
    res.status(426).json({ error: { code: "HTTPS_REQUIRED", message: "This service requires HTTPS." } });
    return;
  }
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.header("Origin")) {
    const allowed = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
      .split(",").map((origin) => origin.trim());
    if (!allowed.includes(req.header("Origin")!)) {
      res.status(403).json({ error: { code: "INVALID_ORIGIN", message: "This request origin is not allowed." } });
      return;
    }
  }
  next();
});
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: uploadLimitBytes, files: 1 } });

const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, message: { error: { code: "RATE_LIMITED", message: "Too many sign-in attempts. Try again shortly." } } });
const error = (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "MediPilot AI API" }));
app.post("/api/auth/login", loginLimit, async (req, res) => {
  const parsed = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(128) }).safeParse(req.body);
  if (!parsed.success) return error(res, 400, "VALIDATION_ERROR", "Enter a valid email and password.");
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase().trim() } });
  const valid = user && await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid || !user) {
    await audit(null, "auth.login_failed", "session");
    return error(res, 401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }
  res.cookie("medipilot_session", await createSession(user.id), {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000, path: "/",
  });
  await audit(user.id, "auth.login", "session");
  return res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, specialty: user.specialty, department: user.department } });
});
app.post("/api/auth/logout", authenticate, async (req, res) => {
  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { id: req.sessionId! } });
    await tx.auditLog.create({ data: { actorId: req.user!.id, action: "auth.logout", resource: "session" } });
  });
  res.clearCookie("medipilot_session", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/" });
  res.json({ ok: true });
});
app.get("/api/auth/me", authenticate, (req, res) => res.json({ user: req.user }));

app.get("/api/doctors", authenticate, async (_req, res) => {
  const doctors = await prisma.user.findMany({
    where: { role: Role.DOCTOR }, select: { id: true, name: true, specialty: true, department: true }, orderBy: { name: "asc" },
  });
  res.json({ items: doctors });
});

app.post("/api/follow-ups", authenticate, allowRoles(Role.DOCTOR), async (req, res) => {
  const input = z.object({ patientId: z.string().min(1), title: z.string().trim().min(3).max(180), dueAt: z.string().datetime() }).safeParse(req.body);
  if (!input.success) return error(res, 400, "VALIDATION_ERROR", "Provide a patient, follow-up title, and due date.");
  if (!await canAccessPatient(req.user!, input.data.patientId)) return error(res, 403, "FORBIDDEN", "You are not authorized to add follow-ups for this patient.");
  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.followUp.create({ data: { ...input.data, dueAt: new Date(input.data.dueAt), doctorId: req.user!.id } });
    await tx.auditLog.create({ data: { actorId: req.user!.id, action: "follow_up.created", resource: "follow_up", resourceId: created.id } });
    return created;
  });
  res.status(201).json({ item });
});

app.patch("/api/follow-ups/:id", authenticate, async (req, res) => {
  const input = z.object({ completed: z.boolean() }).safeParse(req.body);
  if (!input.success) return error(res, 400, "VALIDATION_ERROR", "Choose a valid follow-up status.");
  const item = await prisma.followUp.findUnique({ where: { id: req.params.id } });
  if (!item) return error(res, 404, "NOT_FOUND", "Follow-up not found.");
  const authorized = req.user!.role === Role.ADMIN
    || (req.user!.role === Role.PATIENT && item.patientId === req.user!.id)
    || (req.user!.role === Role.DOCTOR && item.doctorId === req.user!.id && await canAccessPatient(req.user!, item.patientId));
  if (!authorized) {
    await audit(req.user!.id, "access.denied", "follow_up", item.id);
    return error(res, 403, "FORBIDDEN", "You are not authorized to update this follow-up.");
  }
  const updated = await prisma.followUp.update({ where: { id: item.id }, data: { completed: input.data.completed } });
  await audit(req.user!.id, "follow_up.updated", "follow_up", item.id);
  res.json({ item: updated });
});

app.post("/api/consultations", authenticate, allowRoles(Role.DOCTOR), async (req, res) => {
  const input = z.object({
    patientId: z.string().min(1), title: z.string().trim().min(3).max(160), summary: z.string().trim().min(3).max(5000),
  }).safeParse(req.body);
  if (!input.success) return error(res, 400, "VALIDATION_ERROR", "Provide a title and reviewed consultation note.");
  if (!await canAccessPatient(req.user!, input.data.patientId)) {
    await audit(req.user!.id, "access.denied", "consultation");
    return error(res, 403, "FORBIDDEN", "You are not authorized to record a note for this patient.");
  }
  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.medicalRecord.create({
      data: { patientId: input.data.patientId, doctorId: req.user!.id, title: input.data.title, category: "Consultation", summary: input.data.summary },
      select: { id: true, title: true, category: true, summary: true, recordedAt: true },
    });
    await tx.auditLog.create({ data: { actorId: req.user!.id, action: "consultation.note_saved", resource: "medical_record", resourceId: created.id } });
    return created;
  });
  res.status(201).json({ item: record });
});

app.post("/api/prescriptions", authenticate, allowRoles(Role.DOCTOR), async (req, res) => {
  const input = z.object({
    patientId: z.string().min(1), title: z.string().trim().min(3).max(160),
    items: z.array(z.object({
      medicine: z.string().trim().min(1).max(160), strength: z.string().trim().max(80).nullable(),
      dosage: z.string().trim().min(1).max(180), frequency: z.string().trim().min(1).max(160),
      duration: z.string().trim().max(100).nullable(), instructions: z.string().trim().max(300).nullable(),
    })).min(1).max(20),
  }).safeParse(req.body);
  if (!input.success) return error(res, 400, "VALIDATION_ERROR", "Review each medicine and provide its dosage and schedule before finalizing.");
  if (!await canAccessPatient(req.user!, input.data.patientId)) return error(res, 403, "FORBIDDEN", "You are not authorized to prescribe for this patient.");
  const createdAt = new Date();
  const prescription = await prisma.$transaction(async (tx) => {
    const item = await tx.prescription.create({
      data: {
        patientId: input.data.patientId, doctorId: req.user!.id, title: input.data.title,
        itemsJson: JSON.stringify(input.data.items), status: "FINALIZED", createdAt, finalizedAt: createdAt,
      },
    });
    await tx.medicalRecord.create({
      data: { patientId: input.data.patientId, doctorId: req.user!.id, title: input.data.title, category: "Prescription", summary: `${input.data.items.length} prescribed medication${input.data.items.length === 1 ? "" : "s"}. See the verified prescription for details.` },
    });
    await tx.auditLog.create({ data: { actorId: req.user!.id, action: "prescription.finalized", resource: "prescription", resourceId: item.id } });
    return item;
  });
  res.status(201).json({ item: { ...prescription, items: input.data.items } });
});

app.get("/api/prescriptions", authenticate, async (req, res) => {
  const patientId = typeof req.query.patientId === "string" ? req.query.patientId : req.user!.id;
  if (!await canAccessPatient(req.user!, patientId)) {
    await audit(req.user!.id, "access.denied", "prescription");
    return error(res, 403, "FORBIDDEN", "You are not authorized to access these prescriptions.");
  }
  const items = await prisma.prescription.findMany({ where: { patientId, status: "FINALIZED" }, orderBy: { finalizedAt: "desc" }, take: 100 });
  res.json({ items: items.map((item) => ({ ...item, items: JSON.parse(item.itemsJson) })) });
});

app.get("/api/appointments", authenticate, async (req, res) => {
  const where = req.user!.role === Role.PATIENT ? { patientId: req.user!.id } : req.user!.role === Role.DOCTOR ? { doctorId: req.user!.id } : {};
  const items = await prisma.appointment.findMany({
    where, include: { patient: { select: { id: true, name: true } }, doctor: { select: { id: true, name: true, specialty: true } } },
    orderBy: { startsAt: "asc" }, take: 100,
  });
  res.json({ items });
});

app.post("/api/appointments", authenticate, allowRoles(Role.PATIENT), async (req, res) => {
  const input = z.object({
    doctorId: z.string().min(1), startsAt: z.string().datetime(), reason: z.string().trim().min(3).max(240),
  }).safeParse(req.body);
  if (!input.success) return error(res, 400, "VALIDATION_ERROR", "Check the appointment details and try again.");
  const startsAt = new Date(input.data.startsAt);
  if (startsAt <= new Date()) return error(res, 400, "INVALID_TIME", "Choose a future appointment time.");
  const doctor = await prisma.user.findFirst({ where: { id: input.data.doctorId, role: Role.DOCTOR } });
  if (!doctor) return error(res, 404, "DOCTOR_NOT_FOUND", "That doctor is not available.");
  const item = await prisma.$transaction(async (tx) => {
    const conflict = await tx.appointment.findFirst({
      where: {
        status: AppointmentStatus.BOOKED,
        startsAt: { gt: new Date(startsAt.getTime() - 30 * 60_000), lt: new Date(startsAt.getTime() + 30 * 60_000) },
        OR: [{ doctorId: doctor.id }, { patientId: req.user!.id }],
      },
    });
    if (conflict) throw new Error("APPOINTMENT_SLOT_UNAVAILABLE");
    const appointment = await tx.appointment.create({ data: { patientId: req.user!.id, doctorId: doctor.id, startsAt, reason: input.data.reason } });
    await tx.auditLog.create({ data: { actorId: req.user!.id, action: "appointment.booked", resource: "appointment", resourceId: appointment.id } });
    return appointment;
  });
  res.status(201).json({ item });
});

app.get("/api/records", authenticate, async (req, res) => {
  const requestedId = typeof req.query.patientId === "string" ? req.query.patientId : req.user!.id;
  if (!await canAccessPatient(req.user!, requestedId)) {
    await audit(req.user!.id, "access.denied", "patient_record");
    return error(res, 403, "FORBIDDEN", "You are not authorized to access this patient's records.");
  }
  const items = await prisma.medicalRecord.findMany({
    where: { patientId: requestedId }, orderBy: { recordedAt: "desc" }, take: 100,
    select: { id: true, title: true, category: true, summary: true, recordedAt: true },
  });
  await audit(req.user!.id, "records.read", "patient_record", requestedId);
  res.json({ items });
});

app.post("/api/ocr/jobs", authenticate, allowRoles(Role.PATIENT), async (req, res) => {
  res.status(400).json({ error: { code: "UPLOAD_REQUIRED", message: "Upload the document as multipart form data." } });
});

app.post("/api/ocr/jobs/upload", authenticate, allowRoles(Role.PATIENT), upload.single("document"), async (req, res) => {
  const file = req.file;
  const idempotencyKey = req.header("Idempotency-Key");
  if (!file) return error(res, 400, "UPLOAD_REQUIRED", "Select a document to upload.");
  if (!idempotencyKey || !z.string().uuid().safeParse(idempotencyKey).success) return error(res, 400, "IDEMPOTENCY_KEY_REQUIRED", "Retry safely by sending a unique Idempotency-Key.");
  const existing = await prisma.ocrJob.findUnique({ where: { requestKey: idempotencyKey } });
  if (existing) {
    if (existing.uploaderId !== req.user!.id) return error(res, 409, "IDEMPOTENCY_KEY_CONFLICT", "That request key is already in use.");
    return res.json({ item: existing, message: "Returning the result for this upload request." });
  }
  const signatures: Record<string, (buffer: Buffer) => boolean> = {
    "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    "image/png": (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/webp": (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
    "application/pdf": (b) => b.length > 5 && b.toString("ascii", 0, 5) === "%PDF-",
  };
  if (!signatures[file.mimetype]?.(file.buffer)) return error(res, 400, "INVALID_FILE_CONTENT", "File contents do not match a supported document type.");
  const extensions: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" };
  const filePath = path.join(uploadDirectory, `${randomUUID()}${extensions[file.mimetype]}`);
  await mkdir(uploadDirectory, { recursive: true, mode: 0o700 });
  await writeFile(filePath, file.buffer, { mode: 0o600, flag: "wx" });
  let job: OcrJob;
  try {
    job = await prisma.$transaction(async (tx) => {
      const created = await tx.ocrJob.create({
        data: {
          patientId: req.user!.id, uploaderId: req.user!.id, fileName: path.basename(file.originalname).slice(0, 180),
          mimeType: file.mimetype, filePath, requestKey: idempotencyKey, status: OcrStatus.NEEDS_REVIEW, demo: true,
          fieldsJson: JSON.stringify([
            { name: "medicine", value: null, confidence: null, state: "not_detected", sourceText: null },
            { name: "strength", value: null, confidence: null, state: "not_detected", sourceText: null },
            { name: "dosage", value: null, confidence: null, state: "not_detected", sourceText: null },
            { name: "frequency", value: null, confidence: null, state: "not_detected", sourceText: null },
            { name: "duration", value: null, confidence: null, state: "not_detected", sourceText: null },
          ]),
        },
      });
      await tx.auditLog.create({ data: { actorId: req.user!.id, action: "ocr.demo_job_created", resource: "ocr_job", resourceId: created.id } });
      return created;
    });
  } catch (err) {
    await unlink(filePath);
    throw err;
  }
  res.status(201).json({ item: { ...job, fields: JSON.parse(job.fieldsJson) }, message: "Demo intake only: document stored privately; OCR provider is not configured, so no text was extracted." });
});

app.get("/api/ocr/jobs", authenticate, async (req, res) => {
  let where: { patientId?: string | { in: string[] } } = {};
  if (req.user!.role === Role.PATIENT) where = { patientId: req.user!.id };
  if (req.user!.role === Role.DOCTOR) {
    const [appointments, records] = await Promise.all([
      prisma.appointment.findMany({ where: { doctorId: req.user!.id }, select: { patientId: true }, distinct: ["patientId"] }),
      prisma.medicalRecord.findMany({ where: { doctorId: req.user!.id }, select: { patientId: true }, distinct: ["patientId"] }),
    ]);
    where = { patientId: { in: [...new Set([...appointments, ...records].map((item) => item.patientId))] } };
  }
  const items = await prisma.ocrJob.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
  res.json({ items: items.map((item) => ({ ...item, fields: JSON.parse(item.fieldsJson) })) });
});

app.get("/api/ocr/jobs/:id/file", authenticate, async (req, res) => {
  const job = await prisma.ocrJob.findUnique({ where: { id: req.params.id } });
  if (!job) return error(res, 404, "NOT_FOUND", "Document not found.");
  if (!await canAccessPatient(req.user!, job.patientId)) {
    await audit(req.user!.id, "access.denied", "ocr_document", job.id);
    return error(res, 403, "FORBIDDEN", "You are not authorized to view this document.");
  }
  if (!job.filePath) return error(res, 404, "FILE_NOT_FOUND", "The original document is unavailable.");
  const contents = await readFile(job.filePath);
  await audit(req.user!.id, "document.view", "ocr_document", job.id);
  res.setHeader("Content-Type", job.mimeType);
  res.setHeader("Content-Disposition", `${job.mimeType === "application/pdf" ? "attachment" : "inline"}; filename="prescription${path.extname(job.fileName)}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(contents);
});

app.post("/api/ocr/jobs/:id/review", authenticate, allowRoles(Role.DOCTOR, Role.ADMIN), async (req, res) => {
  const fieldSchema = z.object({
    name: z.enum(["medicine", "strength", "dosage", "frequency", "duration"]),
    value: z.string().trim().max(240).nullable(),
    state: z.enum(["verified", "not_found", "unreadable", "needs_review", "not_detected"]),
    sourceText: z.string().max(500).nullable().optional(),
  });
  const input = z.object({ decision: z.enum(["verify", "reject"]), fields: z.array(fieldSchema).length(5) }).safeParse(req.body);
  if (!input.success) return error(res, 400, "VALIDATION_ERROR", "Choose verify or reject.");
  if (new Set(input.data.fields.map((field) => field.name)).size !== 5) return error(res, 400, "VALIDATION_ERROR", "Every prescription field must have an explicit review status.");
  if (input.data.decision === "verify" && input.data.fields.some((field) => !["verified", "not_found", "unreadable"].includes(field.state))) {
    return error(res, 400, "UNREVIEWED_FIELDS", "Explicitly review every field before recording verification.");
  }
  if (input.data.decision === "verify" && !input.data.fields.some((field) => field.name === "medicine" && field.state === "verified" && field.value?.trim())) {
    return error(res, 400, "MEDICINE_REQUIRED", "A clinician must identify at least one medicine from the original document before verifying.");
  }
  const job = await prisma.ocrJob.findUnique({ where: { id: req.params.id } });
  if (!job) return error(res, 404, "NOT_FOUND", "OCR review item not found.");
  if (!await canAccessPatient(req.user!, job.patientId)) {
    await audit(req.user!.id, "access.denied", "ocr_job", job.id);
    return error(res, 403, "FORBIDDEN", "You are not authorized to review this document.");
  }
  if (job.status !== OcrStatus.NEEDS_REVIEW) return error(res, 409, "INVALID_STATE", "This extraction is no longer awaiting review.");
  const reviewedAt = new Date();
  const fieldsJson = JSON.stringify(input.data.fields);
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.ocrJob.updateMany({
      where: { id: job.id, status: OcrStatus.NEEDS_REVIEW },
      data: { status: input.data.decision === "verify" ? OcrStatus.VERIFIED : OcrStatus.REJECTED, reviewerId: req.user!.id, reviewedAt, fieldsJson },
    });
    if (claimed.count !== 1) throw new Error("OCR_REVIEW_ALREADY_COMPLETED");
    await tx.ocrVerification.create({
      data: { ocrJobId: job.id, reviewerId: req.user!.id, decision: input.data.decision, fieldsJson },
    });
    return tx.ocrJob.findUniqueOrThrow({ where: { id: job.id } });
  });
  await audit(req.user!.id, `ocr.${input.data.decision === "verify" ? "verified" : "rejected"}`, "ocr_job", job.id);
  res.json({ item: { ...updated, fields: input.data.fields } });
});

app.post("/api/ai/patient-copilot", authenticate, allowRoles(Role.PATIENT), async (req, res) => {
  const input = z.object({ question: z.string().trim().min(2).max(1000) }).safeParse(req.body);
  if (!input.success) return error(res, 400, "VALIDATION_ERROR", "Enter a question of at least two characters.");
  const records = await prisma.medicalRecord.findMany({
    where: { patientId: req.user!.id }, orderBy: { recordedAt: "desc" }, take: 20,
    select: { id: true, title: true, category: true, summary: true, recordedAt: true },
  });
  await audit(req.user!.id, "copilot.patient_question", "patient_record");
  const answer = records.length
    ? "I can help explain information that is actually in your records. The available demo records are listed below; they do not include enough detail to answer that question reliably. Please discuss personal medical decisions with your care team."
    : "I couldn't find a relevant record to answer this. You can ask your care team for more information. This assistant does not diagnose or recommend medication changes.";
  res.json({ answer, mode: "grounded-demo", sources: records.map(({ id, title, category, recordedAt }) => ({ id, title, category, date: recordedAt })) });
});

app.post("/api/ai/clinical-copilot", authenticate, allowRoles(Role.DOCTOR), async (req, res) => {
  const input = z.object({ patientId: z.string().min(1) }).safeParse(req.body);
  if (!input.success) return error(res, 400, "VALIDATION_ERROR", "A patient must be selected.");
  if (!await canAccessPatient(req.user!, input.data.patientId)) {
    await audit(req.user!.id, "access.denied", "clinical_summary");
    return error(res, 403, "FORBIDDEN", "You are not authorized to access this patient's records.");
  }
  const records = await prisma.medicalRecord.findMany({
    where: { patientId: input.data.patientId }, orderBy: { recordedAt: "desc" }, take: 20,
    select: { id: true, title: true, category: true, summary: true, recordedAt: true },
  });
  await audit(req.user!.id, "copilot.clinical_summary", "patient_record", input.data.patientId);
  res.json({
    summary: records.length ? records.map((record) => `${record.category} — ${record.title} (${record.recordedAt.toISOString().slice(0, 10)}): ${record.summary}`).join("\n\n") : "No records were found for this patient. No history has been inferred.",
    disclaimer: "AI-assisted demo summary. Review the source records; do not copy into signed documentation without clinician review.",
    sources: records.map(({ id, title, category, recordedAt }) => ({ id, title, category, date: recordedAt })),
  });
});

app.get("/api/follow-ups", authenticate, async (req, res) => {
  const where = req.user!.role === Role.PATIENT ? { patientId: req.user!.id } : req.user!.role === Role.DOCTOR ? { doctorId: req.user!.id } : {};
  const items = await prisma.followUp.findMany({ where, orderBy: { dueAt: "asc" }, take: 100 });
  res.json({ items });
});

app.get("/api/admin/analytics", authenticate, allowRoles(Role.ADMIN), async (_req, res) => {
  const [appointments, records, ocrJobs, doctors, patients] = await Promise.all([
    prisma.appointment.count(), prisma.medicalRecord.count(), prisma.ocrJob.count(),
    prisma.user.count({ where: { role: Role.DOCTOR } }), prisma.user.count({ where: { role: Role.PATIENT } }),
  ]);
  res.json({ appointments, records, ocrJobs, doctors, patients, demoData: true });
});

app.get("/api/audit-logs", authenticate, allowRoles(Role.ADMIN), async (req, res) => {
  const query = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).optional(),
  }).safeParse(req.query);
  if (!query.success) return error(res, 400, "VALIDATION_ERROR", "Provide a valid audit-log page.");
  const items = await prisma.auditLog.findMany({
    take: query.data.limit + 1,
    ...(query.data.cursor ? { cursor: { id: query.data.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, actorId: true, action: true, resource: true, resourceId: true, createdAt: true, user: { select: { name: true, role: true } } },
  });
  const hasMore = items.length > query.data.limit;
  if (hasMore) items.pop();
  res.json({ items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null });
});

app.post("/api/admin/doctors", authenticate, allowRoles(Role.ADMIN), async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(2).max(100), email: z.string().email().max(254),
    password: z.string().min(12).max(128), specialty: z.string().trim().min(2).max(80),
  }).safeParse(req.body);
  if (!input.success) return error(res, 400, "VALIDATION_ERROR", "Provide a name, valid email, specialty, and password of at least 12 characters.");
  const exists = await prisma.user.findUnique({ where: { email: input.data.email.toLowerCase() } });
  if (exists) return error(res, 409, "EMAIL_EXISTS", "An account with that email already exists.");
  const passwordHash = await bcrypt.hash(input.data.password, 12);
  const doctor = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { ...input.data, email: input.data.email.toLowerCase(), passwordHash, role: Role.DOCTOR },
      select: { id: true, name: true, email: true, role: true, specialty: true },
    });
    await tx.auditLog.create({ data: { actorId: req.user!.id, action: "admin.doctor_created", resource: "user", resourceId: created.id } });
    return created;
  });
  res.status(201).json({ item: doctor });
});

app.use((req, res) => error(res, 404, "NOT_FOUND", `No route for ${req.method} ${req.path}.`));
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof MulterError) {
    const tooLarge = err.code === "LIMIT_FILE_SIZE";
    return error(res, tooLarge ? 413 : 400, tooLarge ? "FILE_TOO_LARGE" : "INVALID_UPLOAD", tooLarge ? "Choose a document smaller than the upload limit." : "The uploaded document could not be accepted.");
  }
  if (err instanceof Error && err.message === "OCR_REVIEW_ALREADY_COMPLETED") return error(res, 409, "INVALID_STATE", "This extraction was already reviewed.");
  if (err instanceof Error && err.message === "APPOINTMENT_SLOT_UNAVAILABLE") return error(res, 409, "SLOT_UNAVAILABLE", "That time conflicts with a booked appointment. Please choose another.");
  if (typeof err === "object" && err !== null && "status" in err && typeof err.status === "number") {
    if (err.status === 413) return error(res, 413, "REQUEST_TOO_LARGE", "The request is larger than the accepted limit.");
    if (err.status === 400) return error(res, 400, "INVALID_REQUEST", "The request body could not be read.");
  }
  console.error("API request failed; details withheld to protect request data.");
  error(res, 500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
});

export { app };
