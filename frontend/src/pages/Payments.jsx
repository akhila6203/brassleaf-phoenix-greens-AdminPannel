import {
  Box,
  Card,
  CardContent,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPaymentStats, getPayments } from '../api/payments';
import DataTable from '../components/DataTable';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import useDebounce from '../hooks/useDebounce';
import { formatCurrency, formatDateTime, formatNumber, fullName } from '../utils/format';


function todayIsoDate() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}
function StatCard({ label, value }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h5" fontWeight={700}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

export default function Payments() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');


  const debouncedSearch = useDebounce(search);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(20);
  const [stats, setStats] = useState(null);
  const [state, setState] = useState({ rows: [], total: 0, loading: true, error: null });

  useEffect(() => {
  const params = {};

  if (dateFrom && dateTo) {
    params.date_from = dateFrom;
    params.date_to = dateTo;
  }

  getPaymentStats(params)
    .then((r) => setStats(r.data))
    .catch(() => setStats(null));
}, [dateFrom, dateTo]);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    getPayments({
  page: page + 1,
  limit,
  search: debouncedSearch || undefined,

  date_from:
    dateFrom && dateTo
      ? dateFrom
      : undefined,

  date_to:
    dateFrom && dateTo
      ? dateTo
      : undefined,
})
    // getPayments({
    //   page: page + 1,
    //   limit,
    //   search: debouncedSearch || undefined,
    // })
      .then((r) =>
        setState({
          rows: r.data.data || [],
          total: r.data.total || 0,
          loading: false,
          error: null,
        })
      )
      .catch((e) => setState((s) => ({ ...s, loading: false, error: e.message, rows: [] })));
  }, [page, limit, debouncedSearch, dateFrom, dateTo,]);

  useEffect(() => {
  setPage(0);
}, [
  debouncedSearch,
  dateFrom,
  dateTo,
]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    {
      id: 'payment_id',
      label: 'Payment ID',
      width: 90,
      render: (r) => `#${r.payment_id ?? r.id}`,
    },
    {
      id: 'order_id',
      label: 'Order ID',
      render: (r) => (r.order_id != null ? `#${r.order_id}` : '—'),
    },
    {
      id: 'paytm_order_id',
      label: 'Paytm Order ID',
      render: (r) => r.paytm_order_id || r.ORDERID || '—',
    },
    {
      id: 'txn',
      label: 'Transaction ID',
      render: (r) => r.transaction_id || r.TXNID || '—',
    },
    {
      id: 'customer_name',
      label: 'Customer name',
      render: (r) =>
        fullName(r.customer?.first_name, r.customer?.last_name) !== '—'
          ? fullName(r.customer?.first_name, r.customer?.last_name)
          : fullName(r.first_name, r.last_name),
    },
    {
      id: 'email',
      label: 'Email',
      render: (r) => r.customer?.email || r.billing_email || '—',
    },
    {
      id: 'amount',
      label: 'Amount',
      align: 'right',
      render: (r) => formatCurrency(r.amount ?? r.TXNAMOUNT ?? r.total_amount),
    },
    {
      id: 'payment_status',
      label: 'Payment status',
      render: (r) => (
        <StatusBadge value={String(r.status ?? r.STATUS ?? r.status_label ?? '')} />
      ),
    },
    {
      id: 'order_status',
      label: 'Order status',
      render: (r) => (r.order_status ? <StatusBadge value={r.order_status} /> : '—'),
    },
    {
      id: 'payment_mode',
      label: 'Payment mode',
      render: (r) => r.PAYMENTMODE || r.gateway?.PAYMENTMODE || '—',
    },
    {
      id: 'gateway',
      label: 'Gateway',
      render: (r) => r.GATEWAYNAME || r.gateway?.GATEWAYNAME || '—',
    },
    {
      id: 'bank_txn',
      label: 'Bank TXN',
      render: (r) => r.BANKTXNID || r.gateway?.BANKTXNID || '—',
    },
    {
      id: 'refund',
      label: 'Refund',
      align: 'right',
      render: (r) => {
        const amt = r.REFUNDAMT ?? r.gateway?.REFUNDAMT;
        if (amt == null || amt === '' || Number(amt) === 0) return '—';
        return formatCurrency(amt);
      },
    },
    {
      id: 'txn_date',
      label: 'TXN date',
      render: (r) => formatDateTime(r.TXNDATE || r.gateway?.TXNDATE),
    },
    {
      id: 'date_added',
      label: 'Date added',
      render: (r) => formatDateTime(r.date_added),
    },
  ];

  return (
    <Box>
      <PageHeader title="Payments" subtitle={`${formatNumber(state.total)} transactions`} />

      {stats && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              label="Total transactions"
              value={formatNumber(stats.total_transactions ?? stats.total)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard label="Successful" value={formatNumber(stats.successful)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              label="Failed / pending"
              value={formatNumber(stats.failed_or_pending ?? stats.failed)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              label="Total collected"
              value={formatCurrency(stats.total_collected)}
            />
          </Grid>
        </Grid>
      )}

      {/* <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          size="small"
          placeholder="Search order or txn…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 260 }}
        />
      </Stack> */}
      <Stack
  direction={{ xs: 'column', md: 'row' }}
  spacing={1.5}
  sx={{ mb: 2 }}
>
  <TextField
    size="small"
    placeholder="Search order or txn…"
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    sx={{ minWidth: 260 }}
  />

  <TextField
    type="date"
    size="small"
    label="From Date"
    value={dateFrom}
    onChange={(e) => {
      const value = e.target.value;

      setDateFrom(value);

      if (
        dateTo &&
        value &&
        value > dateTo
      ) {
        setDateTo(value);
      }
    }}
    InputLabelProps={{
      shrink: true,
    }}
    sx={{
      minWidth: 180,
    }}
  />

  <TextField
    type="date"
    size="small"
    label="To Date"
    value={dateTo}
    inputProps={{
      min: dateFrom || undefined,
    }}
    onChange={(e) =>
      setDateTo(e.target.value)
    }
    InputLabelProps={{
      shrink: true,
    }}
    sx={{
      minWidth: 180,
    }}
  />
</Stack>

      <DataTable
        columns={columns}
        rows={state.rows}
        loading={state.loading}
        error={state.error}
        page={page}
        rowsPerPage={limit}
        total={state.total}
        onPageChange={setPage}
        onRowsPerPageChange={(n) => {
          setLimit(n);
          setPage(0);
        }}
        onRowClick={(row) => navigate(`/admin/payments/${row.payment_id ?? row.id}`)}
      />
    </Box>
  );
}



// import {
//   Box,
//   Card,
//   CardContent,
//   Grid,
//   Stack,
//   TextField,
//   Typography,
// } from '@mui/material';
// import { useCallback, useEffect, useState } from 'react';
// import { useNavigate } from 'react-router-dom';
// import { getPaymentStats, getPayments } from '../api/payments';
// import DataTable from '../components/DataTable';
// import PageHeader from '../components/PageHeader';
// import StatusBadge from '../components/StatusBadge';
// import useDebounce from '../hooks/useDebounce';
// import { formatCurrency, formatDateTime, formatNumber, fullName } from '../utils/format';

// function StatCard({ label, value }) {
//   return (
//     <Card variant="outlined">
//       <CardContent>
//         <Typography variant="body2" color="text.secondary">
//           {label}
//         </Typography>
//         <Typography variant="h5" fontWeight={700}>
//           {value}
//         </Typography>
//       </CardContent>
//     </Card>
//   );
// }

// export default function Payments() {
//   const navigate = useNavigate();
//   const [search, setSearch] = useState('');
//   const debouncedSearch = useDebounce(search);
//   const [page, setPage] = useState(0);
//   const [limit, setLimit] = useState(20);
//   const [stats, setStats] = useState(null);
//   const [state, setState] = useState({ rows: [], total: 0, loading: true, error: null });

//   useEffect(() => {
//     getPaymentStats()
//       .then((r) => setStats(r.data))
//       .catch(() => setStats(null));
//   }, []);

//   const load = useCallback(() => {
//     setState((s) => ({ ...s, loading: true, error: null }));
//     getPayments({
//       page: page + 1,
//       limit,
//       search: debouncedSearch || undefined,
//     })
//       .then((r) =>
//         setState({
//           rows: r.data.data || [],
//           total: r.data.total || 0,
//           loading: false,
//           error: null,
//         })
//       )
//       .catch((e) => setState((s) => ({ ...s, loading: false, error: e.message, rows: [] })));
//   }, [page, limit, debouncedSearch]);

//   useEffect(() => {
//     setPage(0);
//   }, [debouncedSearch]);

//   useEffect(() => {
//     load();
//   }, [load]);

//   const columns = [
//     {
//       id: 'payment_id',
//       label: 'Payment ID',
//       width: 90,
//       render: (r) => `#${r.payment_id ?? r.id}`,
//     },
//     {
//       id: 'order_id',
//       label: 'Order ID',
//       render: (r) => (r.order_id != null ? `#${r.order_id}` : '—'),
//     },
//     {
//       id: 'paytm_order_id',
//       label: 'Paytm Order ID',
//       render: (r) => r.paytm_order_id || r.ORDERID || '—',
//     },
//     {
//       id: 'txn',
//       label: 'Transaction ID',
//       render: (r) => r.transaction_id || r.TXNID || '—',
//     },
//     {
//       id: 'customer_name',
//       label: 'Customer name',
//       render: (r) =>
//         fullName(r.customer?.first_name, r.customer?.last_name) !== '—'
//           ? fullName(r.customer?.first_name, r.customer?.last_name)
//           : fullName(r.first_name, r.last_name),
//     },
//     {
//       id: 'email',
//       label: 'Email',
//       render: (r) => r.customer?.email || r.billing_email || '—',
//     },
//     {
//       id: 'amount',
//       label: 'Amount',
//       align: 'right',
//       render: (r) => formatCurrency(r.amount ?? r.TXNAMOUNT ?? r.total_amount),
//     },
//     {
//       id: 'payment_status',
//       label: 'Payment status',
//       render: (r) => (
//         <StatusBadge value={String(r.status ?? r.STATUS ?? r.status_label ?? '')} />
//       ),
//     },
//     {
//       id: 'order_status',
//       label: 'Order status',
//       render: (r) => (r.order_status ? <StatusBadge value={r.order_status} /> : '—'),
//     },
//     {
//       id: 'payment_mode',
//       label: 'Payment mode',
//       render: (r) => r.PAYMENTMODE || r.gateway?.PAYMENTMODE || '—',
//     },
//     {
//       id: 'gateway',
//       label: 'Gateway',
//       render: (r) => r.GATEWAYNAME || r.gateway?.GATEWAYNAME || '—',
//     },
//     {
//       id: 'bank_txn',
//       label: 'Bank TXN',
//       render: (r) => r.BANKTXNID || r.gateway?.BANKTXNID || '—',
//     },
//     {
//       id: 'refund',
//       label: 'Refund',
//       align: 'right',
//       render: (r) => {
//         const amt = r.REFUNDAMT ?? r.gateway?.REFUNDAMT;
//         if (amt == null || amt === '' || Number(amt) === 0) return '—';
//         return formatCurrency(amt);
//       },
//     },
//     {
//       id: 'txn_date',
//       label: 'TXN date',
//       render: (r) => formatDateTime(r.TXNDATE || r.gateway?.TXNDATE),
//     },
//     {
//       id: 'date_added',
//       label: 'Date added',
//       render: (r) => formatDateTime(r.date_added),
//     },
//   ];

//   return (
//     <Box>
//       <PageHeader title="Payments" subtitle={`${formatNumber(state.total)} transactions`} />

//       {stats && (
//         <Grid container spacing={2} sx={{ mb: 2 }}>
//           <Grid size={{ xs: 12, sm: 6, md: 3 }}>
//             <StatCard
//               label="Total transactions"
//               value={formatNumber(stats.total_transactions ?? stats.total)}
//             />
//           </Grid>
//           <Grid size={{ xs: 12, sm: 6, md: 3 }}>
//             <StatCard label="Successful" value={formatNumber(stats.successful)} />
//           </Grid>
//           <Grid size={{ xs: 12, sm: 6, md: 3 }}>
//             <StatCard
//               label="Failed / pending"
//               value={formatNumber(stats.failed_or_pending ?? stats.failed)}
//             />
//           </Grid>
//           <Grid size={{ xs: 12, sm: 6, md: 3 }}>
//             <StatCard
//               label="Total collected"
//               value={formatCurrency(stats.total_collected)}
//             />
//           </Grid>
//         </Grid>
//       )}

//       <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
//         <TextField
//           size="small"
//           placeholder="Search order or txn…"
//           value={search}
//           onChange={(e) => setSearch(e.target.value)}
//           sx={{ minWidth: 260 }}
//         />
//       </Stack>

//       <DataTable
//         columns={columns}
//         rows={state.rows}
//         loading={state.loading}
//         error={state.error}
//         page={page}
//         rowsPerPage={limit}
//         total={state.total}
//         onPageChange={setPage}
//         onRowsPerPageChange={(n) => {
//           setLimit(n);
//           setPage(0);
//         }}
//         onRowClick={(row) => navigate(`/admin/payments/${row.payment_id ?? row.id}`)}
//       />
//     </Box>
//   );
// }
