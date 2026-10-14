import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("MediPilot123!", 12);
  const users = [
    { email: "patient@medipilot.demo", name: "Alex Morgan", role: Role.PATIENT, department: null, specialty: null },
    { email: "doctor@medipilot.demo", name: "Dr. Maya Chen", role: Role.DOCTOR, department: "Cardiology", specialty: "Cardiology" },
    { email: "admin@medipilot.demo", name: "Jordan Lee", role: Role.ADMIN, department: null, specialty: null },
  ];
  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, department: user.department, specialty: user.specialty },
      create: { ...user, passwordHash },
    });
  }
  const patient = await prisma.user.findUniqueOrThrow({ where: { email: users[0].email } });
  const doctor = await prisma.user.findUniqueOrThrow({ where: { email: users[1].email } });
  if (await prisma.medicalRecord.count({ where: { patientId: patient.id } }) === 0) {
    await prisma.medicalRecord.createMany({
      data: [
        { patientId: patient.id, doctorId: doctor.id, title: "Annual wellness visit", category: "Consultation", summary: "Routine wellness review. Patient reported feeling well; follow up as scheduled.", recordedAt: new Date("2026-09-18T10:00:00Z") },
        { patientId: patient.id, doctorId: doctor.id, title: "Complete blood count", category: "Lab report", summary: "Synthetic demo report. Refer to the original laboratory report for verified values.", recordedAt: new Date("2026-09-12T10:00:00Z") },
        { patientId: patient.id, doctorId: doctor.id, title: "Medication review", category: "Prescription", summary: "Synthetic demo record. No active medication instructions are represented by this sample.", recordedAt: new Date("2026-08-26T10:00:00Z") },
      ],
    });
  }
  if (await prisma.appointment.count({ where: { patientId: patient.id } }) === 0) {
    await prisma.appointment.create({
      data: { patientId: patient.id, doctorId: doctor.id, startsAt: new Date("2026-10-19T14:30:00Z"), reason: "Follow-up consultation" },
    });
  }
  if (await prisma.followUp.count({ where: { patientId: patient.id } }) === 0) {
    await prisma.followUp.create({
      data: { patientId: patient.id, doctorId: doctor.id, title: "Prepare questions for your follow-up", dueAt: new Date("2026-10-19T12:00:00Z") },
    });
  }
}

main().finally(() => prisma.$disconnect());
