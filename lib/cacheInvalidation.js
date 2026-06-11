const responseCache = require('./responseCache');
const { checkinStatusCache } = require('../portals/employee/utils/employeeContext');

function clearCheckinStatusCacheForCompany(company) {
  if (!company) return;
  const prefix = `${company}:`;
  for (const key of checkinStatusCache.keys()) {
    if (String(key).startsWith(prefix)) checkinStatusCache.delete(key);
  }
}

async function invalidateAttendanceCaches(company) {
  clearCheckinStatusCacheForCompany(company);
  if (!responseCache.cacheEnabled()) return;
  const prefixes = [
    `attendance:stats:${company}:`,
    `attendance:range:${company}:`,
    `dept-team:${company}:`,
  ];
  for (const p of prefixes) {
    await responseCache.invalidatePrefix(p);
  }
}

async function invalidatePayrollCaches(company) {
  if (!responseCache.cacheEnabled() || !company) return;
  await responseCache.invalidatePrefix(`payroll:month:${company}:`);
  await responseCache.invalidatePrefix(`payroll:multi:${company}:`);
}

module.exports = {
  clearCheckinStatusCacheForCompany,
  invalidateAttendanceCaches,
  invalidatePayrollCaches,
};
