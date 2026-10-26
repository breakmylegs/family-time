# Changelog

Release notes the app shows on its System page (from Phase 8). One plain line per change, newest first.

## 0.1.0 (Phase 0, foundations)

- The server runs the api, worker and database, each with health checks.
- Deploys test themselves first and put the previous version back if the new one is unhealthy.
- A database dump is taken before every update.
