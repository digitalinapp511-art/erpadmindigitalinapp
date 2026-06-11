/**
 * One-off migration script (already applied): split the old monolithic
 * hrms-portal/routes/index.js into portals/hrms/utils/hrmsContext.js + portals/hrms/routes/index.js.
 * Do not re-run — it would duplicate or corrupt files. Recover from git history if needed.
 */
console.error(
  'split-hrms-routes.js is deprecated. HRMS routes live under portals/hrms/.'
);
process.exit(1);
