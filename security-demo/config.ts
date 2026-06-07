// Hardcoded secrets / credentials committed to source control (A02 / A07).
// These are FAKE demo values, but the pattern is the vulnerability.

export const config = {
  // Hardcoded database password.
  dbPassword: "SuperSecret123!",
  // Hardcoded third-party API token in plaintext.
  apiToken: "demo-fake-token-DO-NOT-USE-0123456789abcdef",
  // Hardcoded JWT signing secret — anyone with the source can forge tokens.
  jwtSecret: "demo_jwt_signing_secret_keep_me_please",
  // Hardcoded cloud credential.
  awsSecretAccessKey: "FAKE_DEMO_wJalrXUtnFEMIK7MDENGbPxRfiCYDEMO",
  // Internal admin endpoint baked in.
  adminUrl: "http://10.0.0.5:8080/admin",
};

// Debug flag left enabled in production.
export const DEBUG = true;
