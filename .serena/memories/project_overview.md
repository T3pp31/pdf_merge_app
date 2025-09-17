# Project Overview
- Purpose: Provide a PDF merge application. A local Flask app handles uploads and merges PDFs, while the `aws/` folder contains an AWS Lambda implementation of the merge API, and `nginx/` supplies a reverse-proxy configuration.
- Tech stack: Python 3.12, Flask, PyPDF2, Flask-WTF for CSRF, AWS Lambda (Python) for serverless API, Docker + docker-compose for containerized deployment, Nginx as reverse proxy.
- Structure:
  - `app/`: Flask web application (`app.py` entrypoint, Jinja templates under `templates/`).
  - `aws/api/`: Lambda handler (`lambda_function.py`) for PDF merge API; `aws/frontend/` is currently empty.
  - `Dockerfile`, `docker-compose.yml`: define local containerized runtime for the Flask app with Nginx front.
  - `nginx/nginx.conf`: HTTP reverse proxy configuration.
- Notable behavior: Flask route `/merge` merges uploaded PDFs into `/uploads/merged.pdf` then returns the file; Lambda handler expects multipart/form-data and streams PDFs via temporary files, returning merged PDF as base64.