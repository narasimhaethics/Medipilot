# Hackathon demo script (5–7 minutes)

Use the seeded synthetic accounts only. Do not upload real medical documents.

1. **Patient (1 minute):** sign in as `patient@medipilot.demo`, review the synthetic health timeline and next appointment, then book a future time with the listed doctor.
2. **Record-grounded copilot (45 seconds):** ask a question in Health copilot. Show that cited source records are retrieved from the signed-in patient's account and that the answer is explicitly a demo, not medical advice.
3. **Private OCR intake (1 minute):** upload a synthetic JPEG/PNG/WebP/PDF below 8 MB. Show the private-document status and explain that the OCR adapter is offline, so no text or confidence is fabricated.
4. **Clinician review (1 minute):** sign out and sign in as `doctor@medipilot.demo`. Open My patients and confirm the patient is linked through the appointment. In Prescription review, inspect the private original, explicitly mark each field, and verify or reject with a reasoned decision.
5. **Clinical workflow (1–2 minutes):** open Clinical workspace, generate a source-linked summary, edit/review a note, save it, explicitly enter a prescription (no inferred dose), and schedule a follow-up reminder.
6. **Patient continuity (45 seconds):** return to the patient account. Show the saved consultation/prescription and mark the follow-up complete.
7. **Administrator (45 seconds):** sign in as `admin@medipilot.demo`. Review aggregate counts, add a synthetic clinician account, and explain that example chart trends are illustrative rather than operational statistics.
8. **Security (30 seconds):** while signed in as the patient, attempt a record request for another account's ID. The API returns 403 and records a privacy-minimized audit event.

**Honest close:** the application demonstrates authorization and human-in-the-loop workflow mechanics, not clinical readiness, measured OCR accuracy, or regulatory compliance. Provider integration and formal security/privacy/clinical review remain prerequisites.
