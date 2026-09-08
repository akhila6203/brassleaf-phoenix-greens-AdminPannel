const TIMEZONE = 'Asia/Kolkata';
const OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toKolkataParts(date = new Date()) {
  const kolkata = new Date(date.getTime() + OFFSET_MS);
  return {
    year: kolkata.getUTCFullYear(),
    month: kolkata.getUTCMonth(),
    day: kolkata.getUTCDate(),
  };
}

function kolkataMidnightUtc(year, month, day) {
  return new Date(Date.UTC(year, month, day) - OFFSET_MS);
}

function formatKolkataDate(date = new Date()) {
  const p = toKolkataParts(date);
  const d = new Date(Date.UTC(p.year, p.month, p.day));
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function resolveDateRange(query = {}) {
  const preset = query.range || query.date_range || 'today';
  const now = new Date();
  const today = toKolkataParts(now);
  let start;
  let end;
  let label;

  const setDay = (y, m, d) => {
    start = kolkataMidnightUtc(y, m, d);
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    label = formatKolkataDate(start);
  };

  switch (preset) {
    case 'yesterday': {
      const d = new Date(Date.UTC(today.year, today.month, today.day) - 24 * 60 * 60 * 1000);
      const p = { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
      setDay(p.year, p.month, p.day);
      label = `Yesterday · ${label}`;
      break;
    }
    case 'select_date': {
      const single = query.date || query.select_date;
      if (!single) return { start: null, end: null, label: 'Select date', preset };
      const [y, m, d] = String(single).split('-').map(Number);
      setDay(y, m - 1, d);
      break;
    }
    case 'last_7_days':
      start = kolkataMidnightUtc(today.year, today.month, today.day - 6);
      end = new Date(kolkataMidnightUtc(today.year, today.month, today.day + 1).getTime() - 1);
      label = 'Last 7 days';
      break;
    case 'last_30_days':
      start = kolkataMidnightUtc(today.year, today.month, today.day - 29);
      end = new Date(kolkataMidnightUtc(today.year, today.month, today.day + 1).getTime() - 1);
      label = 'Last 30 days';
      break;
    case 'this_month':
      start = kolkataMidnightUtc(today.year, today.month, 1);
      end = new Date(kolkataMidnightUtc(today.year, today.month + 1, 1).getTime() - 1);
      label = 'This month';
      break;
    case 'custom': {
      const from = query.date_from || query.from;
      const to = query.date_to || query.to;
      if (!from || !to) return { start: null, end: null, label: 'Custom date range', preset };
      const [fy, fm, fd] = String(from).split('-').map(Number);
      const [ty, tm, td] = String(to).split('-').map(Number);
      start = kolkataMidnightUtc(fy, fm - 1, fd);
      end = new Date(kolkataMidnightUtc(ty, tm - 1, td + 1).getTime() - 1);
      label = `${from} to ${to}`;
      break;
    }
    case 'today':
    default:
      setDay(today.year, today.month, today.day);
      label = `Today · ${label}`;
      break;
  }

  return {
    preset,
    label,
    timezone: TIMEZONE,
    start: start ? start.toISOString().slice(0, 19).replace('T', ' ') : null,
    end: end ? end.toISOString().slice(0, 19).replace('T', ' ') : null,
    startGmt: start,
    endGmt: end,
  };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function toMysqlDatetime(date) {
  return date ? date.toISOString().slice(0, 19).replace('T', ' ') : null;
}

function resolveInventoryPeriod(query = {}) {
  const period = query.period || 'today';
  const now = new Date();
  const today = toKolkataParts(now);

  const build = (start, end, label, meta = {}) => ({
    period,
    label,
    timezone: TIMEZONE,
    start: toMysqlDatetime(start),
    end: toMysqlDatetime(end),
    startGmt: start,
    endGmt: end,
    ...meta,
  });

  switch (period) {
    case 'date': {
      const single = query.date;
      if (!single) {
        return {
          period,
          label: 'Select date',
          timezone: TIMEZONE,
          start: null,
          end: null,
        };
      }
      const [y, m, d] = String(single).split('-').map(Number);
      const start = kolkataMidnightUtc(y, m - 1, d);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
      return build(start, end, formatKolkataDate(start), { date: single });
    }
    case 'week': {
      const ref = new Date(Date.UTC(today.year, today.month, today.day));
      const dow = ref.getUTCDay();
      const daysFromMonday = dow === 0 ? 6 : dow - 1;
      const mondayMs = ref.getTime() - daysFromMonday * 24 * 60 * 60 * 1000;
      const monday = new Date(mondayMs);
      const start = kolkataMidnightUtc(
        monday.getUTCFullYear(),
        monday.getUTCMonth(),
        monday.getUTCDate()
      );
      const sunday = new Date(mondayMs + 6 * 24 * 60 * 60 * 1000);
      const end = new Date(
        kolkataMidnightUtc(
          sunday.getUTCFullYear(),
          sunday.getUTCMonth(),
          sunday.getUTCDate() + 1
        ).getTime() - 1
      );
      return build(start, end, 'This week');
    }
    case 'month': {
      const year = Number(query.year) || today.year;
      const month = Number(query.month) || today.month + 1;
      const safeMonth = Math.min(12, Math.max(1, month));
      const start = kolkataMidnightUtc(year, safeMonth - 1, 1);
      const end = new Date(kolkataMidnightUtc(year, safeMonth, 1).getTime() - 1);
      return build(start, end, `${MONTH_NAMES[safeMonth - 1]} ${year}`, {
        year,
        month: safeMonth,
      });
    }
    case 'year': {
      const year = Number(query.year) || today.year;
      const start = kolkataMidnightUtc(year, 0, 1);
      const end = new Date(kolkataMidnightUtc(year + 1, 0, 1).getTime() - 1);
      return build(start, end, String(year), { year });
    }
    case 'today':
    default: {
      const start = kolkataMidnightUtc(today.year, today.month, today.day);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
      return build(start, end, `Today · ${formatKolkataDate(start)}`);
    }
  }
}

module.exports = {
  TIMEZONE,
  resolveDateRange,
  resolveInventoryPeriod,
  formatKolkataDate,
  MONTH_NAMES,
  toKolkataParts,
};



// const TIMEZONE = 'Asia/Kolkata';
// const OFFSET_MS = 5.5 * 60 * 60 * 1000;

// function toKolkataParts(date = new Date()) {
//   const kolkata = new Date(date.getTime() + OFFSET_MS);
//   return {
//     year: kolkata.getUTCFullYear(),
//     month: kolkata.getUTCMonth(),
//     day: kolkata.getUTCDate(),
//   };
// }

// function kolkataMidnightUtc(year, month, day) {
//   return new Date(Date.UTC(year, month, day) - OFFSET_MS);
// }

// function formatKolkataDate(date = new Date()) {
//   const p = toKolkataParts(date);
//   const d = new Date(Date.UTC(p.year, p.month, p.day));
//   return d.toLocaleDateString('en-IN', {
//     day: 'numeric',
//     month: 'long',
//     year: 'numeric',
//     timeZone: 'UTC',
//   });
// }

// function resolveDateRange(query = {}) {
//   const preset = query.range || query.date_range || 'today';
//   const now = new Date();
//   const today = toKolkataParts(now);
//   let start;
//   let end;
//   let label;

//   const setDay = (y, m, d) => {
//     start = kolkataMidnightUtc(y, m, d);
//     end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
//     label = formatKolkataDate(start);
//   };

//   switch (preset) {
//     case 'yesterday': {
//       const d = new Date(Date.UTC(today.year, today.month, today.day) - 24 * 60 * 60 * 1000);
//       const p = { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
//       setDay(p.year, p.month, p.day);
//       label = `Yesterday · ${label}`;
//       break;
//     }
//     case 'select_date': {
//       const single = query.date || query.select_date;
//       if (!single) return { start: null, end: null, label: 'Select date', preset };
//       const [y, m, d] = String(single).split('-').map(Number);
//       setDay(y, m - 1, d);
//       break;
//     }
//     case 'last_7_days':
//       start = kolkataMidnightUtc(today.year, today.month, today.day - 6);
//       end = new Date(kolkataMidnightUtc(today.year, today.month, today.day + 1).getTime() - 1);
//       label = 'Last 7 days';
//       break;
//     case 'last_30_days':
//       start = kolkataMidnightUtc(today.year, today.month, today.day - 29);
//       end = new Date(kolkataMidnightUtc(today.year, today.month, today.day + 1).getTime() - 1);
//       label = 'Last 30 days';
//       break;
//     case 'this_month':
//       start = kolkataMidnightUtc(today.year, today.month, 1);
//       end = new Date(kolkataMidnightUtc(today.year, today.month + 1, 1).getTime() - 1);
//       label = 'This month';
//       break;
//     case 'custom': {
//       const from = query.date_from || query.from;
//       const to = query.date_to || query.to;
//       if (!from || !to) return { start: null, end: null, label: 'Custom date range', preset };
//       const [fy, fm, fd] = String(from).split('-').map(Number);
//       const [ty, tm, td] = String(to).split('-').map(Number);
//       start = kolkataMidnightUtc(fy, fm - 1, fd);
//       end = new Date(kolkataMidnightUtc(ty, tm - 1, td + 1).getTime() - 1);
//       label = `${from} to ${to}`;
//       break;
//     }
//     case 'today':
//     default:
//       setDay(today.year, today.month, today.day);
//       label = `Today · ${label}`;
//       break;
//   }

//   return {
//     preset,
//     label,
//     timezone: TIMEZONE,
//     start: start ? start.toISOString().slice(0, 19).replace('T', ' ') : null,
//     end: end ? end.toISOString().slice(0, 19).replace('T', ' ') : null,
//     startGmt: start,
//     endGmt: end,
//   };
// }

// module.exports = { TIMEZONE, resolveDateRange, formatKolkataDate };
