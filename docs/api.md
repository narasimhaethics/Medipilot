# API overview

All endpoints use JSON unless noted. Protected routes require the signed HttpOnly session cookie. Validation errors use `{ "error": { "code": "...", "message": "..." } }`. Pagination is capped; provider credentials and raw OCR content are never exposed.

| Method | Route | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | Process health |
| POST | `/api/auth/login` | Public, rate-limited | Sign in |
| POST | `/api/auth/logout` | Signed in | Clear session |
| GET | `/api/auth/me` | Signed in | Current server-resolved user |
| GET | `/api/doctors` | Signed in | Doctor directory |
| GET / POST | `/api/appointments` | Signed in / patient | List authorized appointments / book an appointment |
| GET | `/api/records?patientId=...` | Signed in, resource-checked | Retrieve a patient timeline |
| GET | `/api/prescriptions?patientId=...` | Signed in, resource-checked | Retrieve finalized prescriptions |
| POST | `/api/prescriptions` | Doctor, patient-checked | Finalize a clinician-entered prescription |
| POST | `/api/consultations` | Doctor, patient-checked | Save a reviewed consultation record |
| POST | `/api/follow-ups` | Doctor, patient-checked | Create a follow-up |
| GET / PATCH | `/api/follow-ups` / `/api/follow-ups/:id` | Signed in, resource-checked | List / update a follow-up |
| POST | `/api/ocr/jobs/upload` | Patient | Multipart upload (`document`, `Idempotency-Key`) |
| GET | `/api/ocr/jobs` | Signed in, patient-filtered | List authorized OCR jobs |
| GET | `/api/ocr/jobs/:id/file` | Signed in, patient-checked | Retrieve a private original |
| POST | `/api/ocr/jobs/:id/review` | Doctor/admin, patient-checked | Record a field-level verification or rejection |
| POST | `/api/ai/patient-copilot` | Patient | Safe answer plus sources from the patient's retrieved records |
| POST | `/api/ai/clinical-copilot` | Doctor, patient-checked | Source-linked clinical summary draft |
| GET | `/api/admin/analytics` | Admin | Aggregate synthetic demo counts |
| GET | `/api/audit-logs?limit=50&cursor=...` | Admin | Paginated audit metadata |
| POST | `/api/admin/doctors` | Admin | Create a doctor account |

## Upload behavior

Upload size is capped by `MAX_UPLOAD_MB`. Supported image/PDF MIME types are checked against the document's magic bytes. Files are stored under a random server-generated name with restrictive file permissions. This demo does not perform malware scanning, OCR, or external processing.

## Example booking

```http
POST /api/appointments
Content-Type: application/json
Cookie: medipilot_session=...

{"doctorId":"<directory id>","startsAt":"<future ISO 8601 time>","reason":"Follow-up"}
```

The backend resolves the patient from the authenticated cookie and rejects overlapping patient or clinician appointments.
