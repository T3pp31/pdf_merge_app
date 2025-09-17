# Task Completion Checklist
- Run relevant unit or integration tests if added in the future; currently no automated tests.
- For Flask work, manually verify PDF upload/merge through `/merge` if feasible.
- For Lambda changes, consider invoking the handler locally or via AWS SAM once configured.
- Ensure temporary files are cleaned up and sensitive data (e.g., merged PDFs) is removed.
- Review docker-compose services if deployment affects container behavior.