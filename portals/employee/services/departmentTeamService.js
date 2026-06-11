const { getUsersCollection } = require('../../../config/mongo');
const { getTodayStatus } = require('./checkinService');
const { getManagerScope } = require('./attendanceRequestsService');
const { checkinStatusCache, CHECKIN_STATUS_CACHE_TTL_MS } = require('../utils/employeeContext');

function normalizeDept(value) {
  return String(value || '').trim().toLowerCase();
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatCheckInTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function isActiveEmployee(user) {
  if (!user) return false;
  if (user.isActive === false || user.active === false) return false;
  return true;
}

function isPresentToday(statusData) {
  if (!statusData) return false;
  if (statusData.status === 'checked-in') return true;
  const minutes = Number(statusData.totalMinutes || 0);
  if (minutes > 0) return true;
  return Boolean(statusData.checkInTime || statusData.earliestPunchInTime);
}

async function findEmployeeByEmployeeId(usersCol, company, employeeId) {
  const employeeKey = String(employeeId || '').trim();
  if (!employeeKey) return null;
  return usersCol.findOne(
    {
      company,
      $or: [
        { employeeId: employeeKey },
        { employeeId: new RegExp(`^${escapeRe(employeeKey)}$`, 'i') },
        { email: new RegExp(`^${escapeRe(employeeKey)}(@|$)`, 'i') },
      ],
    },
    { projection: { name: 1, employeeId: 1, email: 1, department: 1, isActive: 1, active: 1 } }
  );
}

async function listDepartmentTeam({ company, employeeId, userId }) {
  const normalizedCompany = String(company || '').trim();
  const normalizedEmployeeId = String(employeeId || '').trim();
  if (!normalizedCompany || !normalizedEmployeeId) {
    const err = new Error('company and employeeId are required');
    err.statusCode = 400;
    throw err;
  }

  const usersCol = await getUsersCollection(null, normalizedCompany);
  const self = await findEmployeeByEmployeeId(usersCol, normalizedCompany, normalizedEmployeeId);
  if (!self) {
    const err = new Error('Employee not found');
    err.statusCode = 404;
    throw err;
  }

  const deptKey = normalizeDept(self.department);
  if (!deptKey) {
    const managerScope = userId
      ? await getManagerScope({ userId, company: normalizedCompany })
      : { isManager: false, departments: [] };
    return {
      department: '',
      members: [],
      presentCount: 0,
      absentCount: 0,
      totalCount: 0,
      isManager: managerScope.isManager,
      summary: 'No department assigned',
    };
  }

  const colleagues = await usersCol
    .find({ company: normalizedCompany })
    .project({ name: 1, employeeId: 1, email: 1, department: 1, isActive: 1, active: 1 })
    .toArray();

  const team = colleagues
    .filter(isActiveEmployee)
    .filter((u) => normalizeDept(u.department) === deptKey)
    .filter((u) => String(u.employeeId || u.email || '').trim())
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  // Department team refreshes every 60s — use a longer TTL than single-user status polls.
  const cache = { map: checkinStatusCache, ttlMs: Math.max(CHECKIN_STATUS_CACHE_TTL_MS, 30000) };
  const members = await Promise.all(
    team.map(async (u) => {
      const eid = String(u.employeeId || '').trim() || String(u.email || '').trim();
      let statusData = null;
      try {
        statusData = await getTodayStatus({ employeeId: eid, company: normalizedCompany, cache });
      } catch {
        statusData = null;
      }
      const present = isPresentToday(statusData);
      const checkInIso = statusData?.earliestPunchInTime || statusData?.checkInTime || null;
      return {
        employeeId: eid,
        name: u.name || eid,
        isSelf: eid.toLowerCase() === normalizedEmployeeId.toLowerCase(),
        attendanceStatus: present ? 'present' : 'absent',
        statusCode: present ? 'P' : 'A',
        checkInTime: formatCheckInTime(checkInIso),
        checkInTimeIso: checkInIso,
      };
    })
  );

  const managerScope = userId
    ? await getManagerScope({ userId, company: normalizedCompany })
    : { isManager: false, departments: [] };

  const presentCount = members.filter((m) => m.attendanceStatus === 'present').length;
  const absentCount = members.length - presentCount;

  return {
    department: String(self.department || '').trim(),
    members,
    presentCount,
    absentCount,
    totalCount: members.length,
    isManager: managerScope.isManager,
    summary: members.length
      ? `${presentCount} Present · ${absentCount} Absent`
      : 'No team members in your department',
  };
}

module.exports = { listDepartmentTeam };
