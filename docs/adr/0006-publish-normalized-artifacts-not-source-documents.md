---
status: accepted
---

# Publish normalized artifacts, not source documents

DIRF routes each explicitly selected source document through its local AnyDoc-backed ingestion contract and makes only the resulting normalized Markdown and metadata-only provenance manifest eligible for publication. Original Word, PDF, spreadsheet, presentation, and other source bytes remain local; the normalized output must still pass Publication Preflight and receive Publication Approval before upload.
