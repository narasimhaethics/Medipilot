# OCR evaluation and rollout plan

MediPilot's current OCR adapter is intentionally offline. A successful upload means only that a supported file was privately stored. It does not mean text was extracted, a prescription was verified, or a document is authentic.

## Evaluation before enabling a provider

1. Select a provider and document supported languages, image types, handwriting limitations, residency, retention, subprocessors, and outage behavior.
2. Build a consented, privacy-reviewed evaluation set, or begin with synthetic prescriptions covering clear printed text, handwriting, low resolution, rotation, shadows, missing fields, ambiguous medicine names, and look-alike numbers/units.
3. Label exact source text, field values, units, and source locations. Keep test cases and expected results synthetic unless separately approved.
4. Measure character error rate and word error rate by document class and field. Report medication-name, strength/unit, frequency, duration, and decimal/unit error rates separately. Do not report a single accuracy score without dataset scope and methodology.
5. Measure confidence calibration, false-high-confidence rate, no-result rate, reviewer correction/rejection rate, processing latency, provider errors, and retry behavior.
6. Have qualified clinicians set review thresholds and establish rejection/escalation rules. OCR confidence is not clinical correctness.
7. Test prompt injection and malicious content in documents if any LLM is used for layout interpretation. Treat OCR text as untrusted.
8. Run shadow evaluation and human review before any production use. Keep original documents, raw provider output, extraction drafts, reviewer actions, and finalized records separately versioned with least-privilege access.

Never silently infer missing medicine, strength, dosage, frequency, duration, route, or quantity. Low-confidence or conflicting fields must remain visibly uncertain until a qualified reviewer resolves them.
