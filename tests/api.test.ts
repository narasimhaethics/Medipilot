import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { once } from "node:events";
import { randomInt, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { app } from "../apps/api/src/app.js";
import { prisma } from "../apps/api/src/db.js";

type Login = { cookie: string; user: { id: string; role: string } };
type JsonResponse = { response: Response; body: Record<string, any> };

let server: Server;
let baseUrl: string;
let patient: Login;
let doctor: Login;
let admin: Login;
const uploadedJobIds: string[] = [];
const storedFiles: string[] = [];

async function request(path: string, options: RequestInit = {}, cookie?: string): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers,
    },
  });
  return { response, body: await response.json() as Record<string, any> };
}

async function signIn(email: string, password = "MediPilot123!") {
  const { response, body } = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Login did not return a session cookie.");
  return { cookie, user: body.user } as Login;
}

describe("MediPilot API", () => {
  beforeAll(async () => {
    server = app.listen(0);
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    [patient, doctor, admin] = await Promise.all([
      signIn("patient@medipilot.demo"),
      signIn("doctor@medipilot.demo"),
      signIn("admin@medipilot.demo"),
    ]);
  });

  afterAll(async () => {
    const jobs = await prisma.ocrJob.findMany({ where: { id: { in: uploadedJobIds } }, select: { filePath: true } });
    await prisma.ocrJob.deleteMany({ where: { id: { in: uploadedJobIds } } });
    if (patient) await prisma.appointment.deleteMany({ where: { patientId: patient.user.id, reason: "Synthetic integration test appointment" } });
    await prisma.auditLog.deleteMany();
    await Promise.all([...storedFiles, ...jobs.map((job) => job.filePath).filter((item): item is string => Boolean(item))].map((file) => unlink(file).catch(() => undefined)));
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await prisma.$disconnect();
  });

  it("requires a valid signed-in session for protected data", async () => {
    const { response, body } = await request("/api/records");
    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("authenticates demo accounts with an HttpOnly same-site session", async () => {
    const { response } = await request("/api/auth/me", {}, patient.cookie);
    const loginResponse = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "patient@medipilot.demo", password: "MediPilot123!" }) });
    expect(response.status).toBe(200);
    expect(loginResponse.response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(loginResponse.response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(patient.user.role).toBe("PATIENT");
  });

  it("rejects cross-patient record access and records the denied attempt", async () => {
    const { response, body } = await request(`/api/records?patientId=${doctor.user.id}`, {}, patient.cookie);
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(await prisma.auditLog.count({ where: { actorId: patient.user.id, action: "access.denied", resource: "patient_record" } })).toBeGreaterThan(0);
  });

  it("books an appointment and rejects a conflicting retry", async () => {
    const doctors = await request("/api/doctors", {}, patient.cookie);
    const doctorId = doctors.body.items[0].id as string;
    const startsAt = new Date(Date.now() + (365 + randomInt(1, 300)) * 24 * 60 * 60 * 1000).toISOString();
    const payload = JSON.stringify({ doctorId, startsAt, reason: "Synthetic integration test appointment" });
    const first = await request("/api/appointments", { method: "POST", body: payload }, patient.cookie);
    const conflict = await request("/api/appointments", { method: "POST", body: payload }, patient.cookie);
    expect(first.response.status).toBe(201);
    expect(first.body.item.patientId).toBe(patient.user.id);
    expect(conflict.response.status).toBe(409);
    expect(conflict.body.error.code).toBe("SLOT_UNAVAILABLE");
    const doctorSchedule = await request("/api/appointments", {}, doctor.cookie);
    expect(doctorSchedule.body.items.some((item: { id: string }) => item.id === first.body.item.id)).toBe(true);
  });

  it("refuses role escalation and blocks unauthorized clinical writes", async () => {
    const response = await request("/api/consultations", {
      method: "POST",
      body: JSON.stringify({ patientId: doctor.user.id, title: "Unauthorized", summary: "Must not be saved." }),
    }, patient.cookie);
    expect(response.response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("stores a private demo OCR upload and verifies every field with an authorized clinician", async () => {
    const validPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Z5sAAAAASUVORK5CYII=", "base64");
    const form = new FormData();
    form.append("document", new Blob([validPng], { type: "image/png" }), "synthetic-prescription.png");
    const key = randomUUID();
    const upload = await request("/api/ocr/jobs/upload", {
      method: "POST", body: form, headers: { "Idempotency-Key": key },
    }, patient.cookie);
    expect(upload.response.status).toBe(201);
    expect(upload.body.message).toContain("no text was extracted");
    expect(upload.body.item.demo).toBe(true);
    uploadedJobIds.push(upload.body.item.id);
    storedFiles.push(upload.body.item.filePath);

    const retryForm = new FormData();
    retryForm.append("document", new Blob([validPng], { type: "image/png" }), "synthetic-prescription.png");
    const retry = await request("/api/ocr/jobs/upload", {
      method: "POST", body: retryForm, headers: { "Idempotency-Key": key },
    }, patient.cookie);
    expect(retry.response.status).toBe(200);
    expect(retry.body.item.id).toBe(upload.body.item.id);

    const fields = ["medicine", "strength", "dosage", "frequency", "duration"].map((name) => ({
      name,
      value: name === "medicine" ? "Synthetic test entry — not a real medication" : null,
      state: name === "medicine" ? "verified" : "not_found",
      sourceText: null,
    }));
    const verified = await request(`/api/ocr/jobs/${upload.body.item.id}/review`, {
      method: "POST", body: JSON.stringify({ decision: "verify", fields }),
    }, doctor.cookie);
    expect(verified.response.status).toBe(200);
    expect(verified.body.item.status).toBe("VERIFIED");
    expect(await prisma.ocrVerification.count({ where: { ocrJobId: upload.body.item.id } })).toBe(1);

    const original = await fetch(`${baseUrl}/api/ocr/jobs/${upload.body.item.id}/file`, { headers: { Cookie: patient.cookie } });
    expect(original.status).toBe(200);
    expect(original.headers.get("content-type")).toContain("image/png");
    expect(await original.arrayBuffer()).toHaveProperty("byteLength", validPng.length);
  });

  it("does not let the patient approve an OCR draft or accept unsupported verification", async () => {
    const created = await prisma.ocrJob.create({
      data: {
        patientId: patient.user.id, uploaderId: patient.user.id, fileName: "synthetic-review.png", mimeType: "image/png",
        status: "NEEDS_REVIEW", demo: true, fieldsJson: "[]",
      },
    });
    uploadedJobIds.push(created.id);
    const forbidden = await request(`/api/ocr/jobs/${created.id}/review`, {
      method: "POST", body: JSON.stringify({ decision: "verify", fields: [] }),
    }, patient.cookie);
    expect(forbidden.response.status).toBe(403);
    const unreviewed = await request(`/api/ocr/jobs/${created.id}/review`, {
      method: "POST", body: JSON.stringify({ decision: "verify", fields: ["medicine", "strength", "dosage", "frequency", "duration"].map((name) => ({ name, value: null, state: "not_detected" })) }),
    }, doctor.cookie);
    expect(unreviewed.response.status).toBe(400);
    expect(unreviewed.body.error.code).toBe("UNREVIEWED_FIELDS");
  });

  it("returns only retrieved source IDs and protects admin analytics by role", async () => {
    const copilot = await request("/api/ai/patient-copilot", {
      method: "POST", body: JSON.stringify({ question: "Explain my records" }),
    }, patient.cookie);
    const recordIds = new Set((await prisma.medicalRecord.findMany({ where: { patientId: patient.user.id }, select: { id: true } })).map((record) => record.id));
    expect(copilot.response.status).toBe(200);
    expect(copilot.body.sources.every((source: { id: string }) => recordIds.has(source.id))).toBe(true);
    const patientAnalytics = await request("/api/admin/analytics", {}, patient.cookie);
    const adminAnalytics = await request("/api/admin/analytics", {}, admin.cookie);
    expect(patientAnalytics.response.status).toBe(403);
    expect(adminAnalytics.response.status).toBe(200);
  });

  it("revokes the server-side session at logout", async () => {
    const sessionId = patient.cookie.split("=")[1].split(".")[0];
    expect(await prisma.session.count({ where: { id: sessionId } })).toBe(1);
    const logout = await request("/api/auth/logout", { method: "POST" }, patient.cookie);
    const currentSession = await request("/api/auth/me", {}, patient.cookie);
    expect(logout.response.status).toBe(200);
    expect(currentSession.response.status).toBe(401);
    expect(await prisma.session.count({ where: { id: sessionId } })).toBe(0);
  });
});
