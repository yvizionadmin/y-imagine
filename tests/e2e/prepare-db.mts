// Fresh database for the E2E server: create, migrate, empty (same as the Vitest global setup).
import setup from "../setup/global-setup.mjs";

await setup();
