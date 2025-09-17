# Code Style and Conventions
- Python code uses type hints (including `typing` generics) and docstrings describing behavior in Japanese; plain functions in Flask app omit docstrings.
- Keep imports standard library first, then third-party. Existing AWS Lambda module uses explicit typing aliases and helper builders.
- Error handling: prefer `try`/`except` blocks with specific exceptions where possible and return HTTP-friendly error messages.
- Logging/debugging: Lambda function currently uses `print` statements for diagnostics.
- File handling: Use temporary files under `/tmp` for Lambda; ensure cleanup in `finally` blocks. Flask app writes to `uploads/merged.pdf` and deletes after response.