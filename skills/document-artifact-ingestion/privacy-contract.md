# Privacy contract

- Authorization is path-specific. A selected file does not authorize sibling
  files, its parent folder, a repository, a Drive, or an account.
- A converter necessarily reads the selected source bytes transiently. DIRF
  must never claim that conversion happens without reading the source.
- Source bytes stay on the local machine. The pinned AnyDoc CLI runs locally;
  hosted Firecrawl Parse and other remote fallbacks are prohibited.
- Only normalized Markdown and a metadata-only provenance manifest may persist.
  The manifest may contain paths, sizes, timestamps, parser identity, and
  hashes, but never document content or encoded source bytes.
- Artifact consumers are ingestion and assessment workflows. User-facing
  clients may list safe metadata but must not retrieve artifact bodies.
- Scanned or image-only PDFs require a separately approved OCR capability and
  data-handling decision; they are unsupported here.
- Any temporary or partial output created by a failed conversion is deleted.
