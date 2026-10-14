# Security, privacy, and production readiness

## Implemented in this demo

- bcrypt password hashes; no plaintext passwords in the database.
- HMAC-signed, expiring, HttpOnly, SameSite=Strict session cookie backed by revocable database sessions; Secure in production.
- The server resolves the current role from the database and checks patient-record authorization for every relevant resource operation.
- Helmet security headers, a JSON request-size cap, request rate limits, login rate limits, exact allowed-origin checks on state-changing requests, and an HTTPS-only production guard.
- Zod request validation, generic API error messages, and request-error logs that intentionally omit exception details and medical values.
- Upload limits, supported MIME allowlisting, file-signature checks, random storage names, private filesystem permissions, no public static upload route, authorized document retrieval, and idempotency keys.
- Audit records for login, sensitive record reads, denied access, OCR review, consultation, prescription, and follow-up operations.
- Transactions for appointment conflict checks + booking audit, prescription creation + timeline integration, clinician-note persistence, and OCR disposition + verification history.
- Synthetic-only seed data. Demo AI/OCR providers are offline.
- Production startup rejects the example session secret, non-PostgreSQL database URLs, and plain-HTTP requests.

## Required before real clinical use

This list is not an assertion of regulatory compliance. Obtain a qualified legal, clinical, privacy, and security assessment for the intended jurisdiction and workflow.

1. Replace SQLite with managed PostgreSQL, TLS connections, encrypted backups, least-privilege service credentials, tested migrations, and disaster-recovery procedures.
2. Add production identity federation, MFA, secure account recovery, secret rotation through a managed store, session cleanup/monitoring, and identity assurance appropriate to the care workflow.
3. Terminate TLS at a trusted proxy, configure proxy trust precisely, validate deployment origins/hostnames, and verify HSTS/CSP policy for the real frontend.
4. Move medical files to private encrypted object storage; add malware scanning, PDF/image sandboxing, retention/deletion workflows, backup policy, and short-lived authorized downloads.
5. Add comprehensive consent/preferences, patient access requests, correction workflows, retention schedules, and immutable/versioned clinical records.
6. Integrate a supported OCR provider with contractual/privacy review, geographic data residency controls, minimum-necessary redaction, timeout/retry handling, background jobs, and measured performance on representative synthetic and appropriately approved evaluation data.
7. Integrate any LLM only after security, privacy, clinical-safety, and provider-retention review. Use a tested retrieval boundary, prompt-injection defenses for source documents, structured output validation, data minimization, clinical oversight, and incident handling.
8. Add clinician identity/credential validation, fine-grained department and assignment authorization, appointment availability rules, prescription signing/authenticity checks, complete correction/version history, and a clinical hazard review.
9. Harden audit storage against tampering; define access, retention, export, alerting, and breach-response procedures. Avoid collecting unnecessary identifiers or clinical content in logs/metrics.
10. Add dependency/container scanning, SBOMs, penetration testing, independent threat modeling, backup/restore drills, accessibility testing, load testing, and operational monitoring.
11. Add secure account and consent workflows, CSRF tokens if deployment/session configuration requires them, and verified notification channels.

## Known limitations

- Local SQLite is runtime-tested; a PostgreSQL schema and local Compose service are included but were not runtime-tested because Docker/PostgreSQL were unavailable in the implementation environment.
- Demo auth has seeded shared passwords; no MFA, email verification, or account lockout. Database sessions expire after eight hours and logout revokes the current session.
- OCR intake stores documents privately, but OCR extraction, preprocessing, asynchronous jobs, malware scanning, and object storage are not configured. Empty values remain empty; there is no OCR accuracy claim.
- A clinician may manually review and record a field decision; the demo does not attest prescription authenticity, signature, or clinical appropriateness.
- AI endpoints are deterministic record-grounded demo responses/summaries, not a connected LLM. No diagnosis, medication recommendation, or provider call is made.
- Care plans, consent management, full allergy/lab models, notifications, reminders, doctor availability, and appointment cancellation/rescheduling remain out of scope for this runnable first release.
- The sample analytics chart is illustrative; all operational counts are aggregate demo counts.
