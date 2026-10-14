# MediPilot AI

MediPilot AI is a role-based healthcare workflow demo for patients, doctors, and hospital administrators. It includes a React dashboard, an Express API, a Prisma database, private prescription-document storage, appointment booking, audited clinician review, prescription and follow-up workflows, and record-grounded demo copilots.

> **Demo only.** Seed data is synthetic. The AI and OCR providers are deliberately offline: uploaded documents are stored privately, but no OCR or external AI service is called. This project is not a medical device, does not provide medical advice, and has not been assessed for HIPAA, GDPR, or any other regulatory compliance. Do not upload real patient information.

## Requirements

- Node.js 20.19+ (tested with Node 24.21.0) and npm.
- No Docker or PostgreSQL server is needed for the local SQLite demo.
- For local TLS, email, malware scanning, and external AI/OCR, configure your own production infrastructure and providers.

If Node is installed through nvm in a new terminal, activate it first:

```bash
source "$HOME/.nvm/nvm.sh"
node --version
npm --version
```

## Start locally

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open **http://localhost:5173**. The Vite development server proxies `/api` requests to the Express API at port 4000.
If port 4000 is already occupied, set `PORT=4100` in `.env` (or export it before `npm run dev`); Vite uses that same API port.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Patient | `patient@medipilot.demo` | `MediPilot123!` |
| Doctor | `doctor@medipilot.demo` | `MediPilot123!` |
| Administrator | `admin@medipilot.demo` | `MediPilot123!` |

These are demo credentials only. Never reuse them or the example session secret in a deployed environment.

### Build and run

```bash
npm run build
npm start
```

`npm run build` type-checks both TypeScript projects, emits the API under `dist-api/`, and creates the static frontend under `dist/`. In production, serve `dist/` with a TLS-terminating web server/reverse proxy and forward `/api` to the Node API. The API enforces HTTPS when `NODE_ENV=production`.

## Database and seed data

The out-of-the-box local configuration uses SQLite to keep the demo runnable without Docker or a database server. `prisma/schema.prisma` is the source of truth for this development database. Apply the checked-in Prisma migration and refresh synthetic users/records with:

```bash
npm run db:migrate
npm run db:seed
```

Use `npm run db:push` only for local schema prototyping. Deploy checked-in migrations with `npm run db:migrate:deploy`. The database file and private documents are local development artifacts, excluded from Git. Back up or delete these local demo files deliberately; they are not production storage.

### Optional local PostgreSQL

The repository also includes a PostgreSQL 16 schema at `prisma/postgresql/schema.prisma` and a local-only Compose service. Docker was not available in the implementation environment, so this option is provided but is not runtime-tested here.

```bash
docker compose up -d postgres
```

Set `DATABASE_URL` in `.env` to the PostgreSQL URL shown in `.env.example`, using the same unique local password as `POSTGRES_PASSWORD`, then create the PostgreSQL client/schema and synthetic data:

```bash
npm run db:generate:postgres
npm run db:migrate:postgres -- --name init
npm run db:seed
```

Commit the generated PostgreSQL migration and use `npm run db:migrate:deploy:postgres` to apply it in a deployment. The SQLite and PostgreSQL Prisma schemas must remain structurally aligned; use the matching generate/migrate commands for the selected provider. Compose credentials are for local development only and must never be used in production.

## Tests

Run the API integration tests; `npm test` prepares a separate ignored `prisma/test.db`, seeds its synthetic users, and leaves the normal development database untouched:

```bash
npm test
```

The tests start the API on an ephemeral port and cover authentication, role checks, cross-patient record denial and audit, appointment conflicts, private upload/idempotency, clinician-only verification, source references, and admin-only analytics. Test-created appointments and audit rows are cleaned up afterward.

## Implemented workflows

- **Patient:** sign in, view a health timeline, book a doctor, privately submit a supported document for demo intake, ask a source-grounded question, review prescriptions and follow-up reminders.
- **Doctor:** see connected patients and appointments, access authorized records, review uploaded document images and explicitly disposition each extraction field, save reviewed consultation notes, finalize doctor-entered prescriptions, and create patient follow-ups.
- **Administrator:** create doctor accounts and see aggregate counts and clearly labelled illustrative analytics.
- **Security demo:** role checks and patient-resource authorization are enforced on the API, eight-hour signed cookies are backed by revocable database sessions, failed cross-patient access is denied and audited, and audit metadata is available through an admin-only paginated API.

## Configuration

See [.env.example](./.env.example). Important settings:

- `DATABASE_URL`: local SQLite URL by default.
- `SESSION_SECRET`: replace with a randomly generated value (at least 32 characters) before production; the API refuses production startup without it.
- `ALLOWED_ORIGINS`: exact allowed browser origins for state-changing requests.
- `MAX_UPLOAD_MB`: upload limit (default 8 MB).
- `UPLOAD_DIRECTORY`: private document directory (never expose it through a static server).
- `OCR_PROVIDER` and `LLM_PROVIDER`: remain `demo` until an evaluated, secured provider adapter is implemented.

## Provider and database status

The application exposes explicit demo behavior rather than implying a live connection. OCR uploads are validated by file signature, stored privately, and given empty/not-detected fields for human review; there is no OCR, image preprocessing, malware scanner, or OCR accuracy claim. Patient and clinical copilots retrieve authorized database records but return a safe demo explanation/summary; there is no LLM provider or generated clinical interpretation. No credentials are sent to third parties.

The tested local path uses Prisma with SQLite; an optional PostgreSQL schema and Compose service are included above but were not runtime-tested in this environment. Production hosting, managed database operations, private object storage, malware scanning, an OCR adapter, an LLM adapter, and medical privacy/regulatory assessment remain production work; see [docs/security-and-privacy.md](./docs/security-and-privacy.md) and [docs/architecture.md](./docs/architecture.md).

## Documentation

- [Architecture and data flow](./docs/architecture.md)
- [API overview](./docs/api.md)
- [Security, privacy, and production checklist](./docs/security-and-privacy.md)
- [OCR evaluation approach](./docs/ocr-evaluation.md)
- [Hackathon demo script](./docs/demo-script.md)
