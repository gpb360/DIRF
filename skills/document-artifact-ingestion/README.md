---
name: document-artifact-ingestion
kind: skill
description: "Converts explicitly authorized local documents into provenance-bound Markdown artifacts for DIRF and governance evidence ingestion without retaining source bytes"
uses: []
details: ["privacy-contract.md", "scripts/"]
inputs: ["explicitly authorized document path", "artifact and manifest paths"]
outputs: ["normalized Markdown artifact", "provenance manifest with source and artifact hashes"]
capabilities: ["document normalization", "evidence ingestion", "artifact provenance"]
---

# Document artifact ingestion

Use this skill only for an exact document path the user or an authorized
workflow selected. Never enumerate, sweep, or infer permission over a folder,
Drive, repository, or account.

## Contract

1. Read [privacy-contract.md](privacy-contract.md) before conversion.
2. Create a unique `.md` artifact path and `.json` manifest path inside the
   current attempt's `artifacts/` directory. Do not overwrite either output.
3. Run the pinned local converter:

   ```text
   node skills/document-artifact-ingestion/scripts/normalize-document.mjs --attempt-root <attempt-directory> --input <authorized-file> --output <attempt-directory>/artifacts/<artifact.md> --manifest <attempt-directory>/artifacts/<artifact.json>
   ```

4. Treat the source read as transient. Do not copy, upload, log, or embed source
   bytes. The persistable outputs are the normalized Markdown artifact and its
   provenance manifest only.
5. Verify both hashes in the manifest and pass the artifact path—not the source
   path—to downstream ingestion or assessment.
6. Fail closed on encrypted, malformed, resource-limited, unsupported, or
   image-only documents. Do not fall back to a hosted parser or OCR service.

Supported binary formats are Word, PowerPoint, Excel, OpenDocument, RTF, EPUB,
CSV, and text-bearing PDF variants supported by AnyDoc 0.1.8. Markdown, text,
JSON, XML, HTML, YAML, and RST use DIRF's built-in local text normalization.

Completion means the source and artifact SHA-256 hashes are recorded, the
artifact is non-empty Markdown, no raw source bytes exist in the outputs, and
the downstream consumer receives only the artifact and manifest.
