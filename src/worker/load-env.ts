// Loaded first by the worker and scripts: reads .env when present (containers pass env directly).
try {
  process.loadEnvFile?.(".env");
} catch {
  /* no .env file */
}
export {};
