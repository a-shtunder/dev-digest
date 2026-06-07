# security-demo (throwaway test fixture)

Intentionally vulnerable sample code used to exercise the **Security Reviewer**
agent. Every file here contains one or more deliberate OWASP-style issues
(hardcoded secrets, SQL/command injection, SSRF, path traversal, weak crypto,
broken access control, XSS, open redirect, insecure deserialization).

DO NOT ship any of this. This directory exists only to verify that the reviewer
flags real findings, and will be deleted.
