import type { NextFunction, Request, Response } from "express";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Role } from "@prisma/client";
import { prisma } from "./db.js";

export type SessionUser = { id: string; name: string; email: string; role: Role; specialty: string | null; department: string | null };
declare global {
  namespace Express {
    interface Request { user?: SessionUser; sessionId?: string }
  }
}

const sessionSecret = () => process.env.SESSION_SECRET ?? "development-only-secret";

export async function createSession(userId: string) {
  const id = randomUUID();
  const expires = Date.now() + 8 * 60 * 60 * 1000;
  await prisma.session.create({ data: { id, userId, expiresAt: new Date(expires) } });
  const payload = `${id}.${expires}`;
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

function readSession(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3 || !/^\d+$/.test(parts[1]) || Number(parts[1]) <= Date.now()) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest();
  let provided: Buffer;
  try { provided = Buffer.from(parts[2], "hex"); } catch { return null; }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return { id: parts[0], expiresAt: Number(parts[1]) };
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.medipilot_session;
    const claims = typeof token === "string" ? readSession(token) : null;
    if (!claims) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } });
      return;
    }
    const session = await prisma.session.findUnique({
      where: { id: claims.id },
      select: {
        expiresAt: true,
        user: { select: { id: true, name: true, email: true, role: true, specialty: true, department: true } },
      },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (session) await prisma.session.delete({ where: { id: claims.id } });
      res.clearCookie("medipilot_session");
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Your session has expired." } });
      return;
    }
    req.user = session.user;
    req.sessionId = claims.id;
    next();
  } catch (err) {
    next(err);
  }
}

export function allowRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "You don't have permission to perform this action." } });
      return;
    }
    next();
  };
}

export async function canAccessPatient(actor: SessionUser, patientId: string) {
  if (actor.role === Role.ADMIN || (actor.role === Role.PATIENT && actor.id === patientId)) return true;
  if (actor.role !== Role.DOCTOR) return false;
  const [hasRecords, hasAppointments] = await Promise.all([
    prisma.medicalRecord.count({ where: { patientId, doctorId: actor.id } }),
    prisma.appointment.count({ where: { patientId, doctorId: actor.id } }),
  ]);
  return hasRecords > 0 || hasAppointments > 0;
}

export async function audit(actorId: string | null, action: string, resource: string, resourceId?: string) {
  await prisma.auditLog.create({ data: { actorId, action, resource, resourceId } });
}
