---
status: accepted
---

# Fail closed on evidence publication preflight

Every Publication Candidate must pass deterministic checks for secrets, credentials, and private data before it can become a Publication Revision. Human review remains required, but approval is bound to the exact candidate digest and cannot override a preflight finding; DIRF must block publication and identify what was missed. The publisher revalidates that approved digest before upload so different bytes cannot be substituted after review.
