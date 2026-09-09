import DownloadIcon from '@mui/icons-material/Download';
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getGstExport, getGstReport } from '../api/gst';
import EmptyState from '../components/EmptyState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageHeader from '../components/PageHeader';
import { useSnackbar } from '../context/SnackbarContext';
import useDebounce from '../hooks/useDebounce';
import { downloadGstExcel } from '../utils/gstExcelExport';
import { formatDate } from '../utils/format';

const PERIOD_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'date', label: 'Date' },
  { value: 'range', label: 'Date Range' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'invoice', label: 'Invoice Number' },
  { value: 'order', label: 'Order Number' },
  { value: 'product', label: 'Product Name A-Z' },
  { value: 'value_high', label: 'Highest Value' },
  { value: 'value_low', label: 'Lowest Value' },
  { value: 'gst_high', label: 'Highest GST' },
  { value: 'gst_low', label: 'Lowest GST' },
];

const MONTH_OPTIONS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

function todayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `₹${Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercent(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const value = Number(n);
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

export default function Gst() {
  const now = new Date();
  const { showToast } = useSnackbar();
  const [period, setPeriod] = useState('today');
  const [selectedDate, setSelectedDate] = useState(todayIsoDate());
  const [dateFrom, setDateFrom] = useState(todayIsoDate());
  const [dateTo, setDateTo] = useState(todayIsoDate());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [yearFilter, setYearFilter] = useState(now.getFullYear());
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(20);
  const [availableYears, setAvailableYears] = useState([now.getFullYear()]);
  const [downloading, setDownloading] = useState(false);
  const [state, setState] = useState({
    loading: true,
    error: null,
    rows: [],
    total: 0,
    filter: null,
  });

  const debouncedSearch = useDebounce(search, 350);

  const filterParams = useMemo(() => {
    const params = {
      period,
      sort,
      search: debouncedSearch || undefined,
      page: page + 1,
      limit,
    };

    if (period === 'date') {
      params.date = selectedDate;
    } else if (period === 'range') {
      params.date_from = dateFrom;
      params.date_to = dateTo;
    } else if (period === 'month') {
      params.year = selectedYear;
      params.month = selectedMonth;
    } else if (period === 'year') {
      params.year = yearFilter;
    }

    return params;
  }, [
    period,
    sort,
    debouncedSearch,
    page,
    limit,
    selectedDate,
    dateFrom,
    dateTo,
    selectedYear,
    selectedMonth,
    yearFilter,
  ]);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));

    getGstReport(filterParams)
      .then((res) => {
        const data = res.data || {};
        setState({
          loading: false,
          error: null,
          rows: data.data || [],
          total: data.total || 0,
          filter: data.filter,
        });
        if (Array.isArray(data.available_years) && data.available_years.length) {
          setAvailableYears(data.available_years);
        }
      })
      .catch((e) => {
        setState({
          loading: false,
          error: e.message,
          rows: [],
          total: 0,
          filter: null,
        });
      });
  }, [filterParams]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(0);
  }, [
    period,
    selectedDate,
    dateFrom,
    dateTo,
    selectedYear,
    selectedMonth,
    yearFilter,
    debouncedSearch,
    sort,
  ]);

  const handlePeriodChange = (nextPeriod) => {
    setPeriod(nextPeriod);

    if (nextPeriod === 'month') {
      const current = new Date();
      setSelectedYear(current.getFullYear());
      setSelectedMonth(current.getMonth() + 1);
    }

    if (nextPeriod === 'year') {
      setYearFilter(new Date().getFullYear());
    }
  };

  const handleDownloadExcel = async () => {
    if (state.loading) return;

    setDownloading(true);
    try {
      const exportParams = { ...filterParams };
      delete exportParams.page;
      delete exportParams.limit;

      const res = await getGstExport(exportParams);
      const payload = res.data || {};

      await downloadGstExcel({
        filter: payload.filter || state.filter,
        items: payload.data || [],
      });
      showToast('GST sheet downloaded', 'success');
    } catch (e) {
      showToast(e.message || 'Unable to download GST sheet', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const serialOffset = page * limit;

  return (
    <Box>
      <PageHeader
        title="GST"
        subtitle="Product GST sales register"
        actions={
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            disabled={downloading || state.loading || Boolean(state.error)}
            onClick={handleDownloadExcel}
          >
            {downloading ? 'Downloading…' : 'Download Sheet'}
          </Button>
        }
      />

      <Stack spacing={2} sx={{ mb: 3 }}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {PERIOD_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              size="small"
              variant={period === opt.value ? 'contained' : 'outlined'}
              onClick={() => handlePeriodChange(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </Stack>

        {period === 'date' && (
          <TextField
            type="date"
            size="small"
            label="Select Date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ maxWidth: 220 }}
          />
        )}

        {period === 'range' && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              type="date"
              size="small"
              label="From Date"
              value={dateFrom}
              onChange={(e) => {
                const value = e.target.value;
                setDateFrom(value);
                if (dateTo && value > dateTo) {
                  setDateTo(value);
                }
              }}
              InputLabelProps={{ shrink: true }}
              sx={{ maxWidth: 220 }}
            />
            <TextField
              type="date"
              size="small"
              label="To Date"
              value={dateTo}
              inputProps={{ min: dateFrom || undefined }}
              onChange={(e) => setDateTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ maxWidth: 220 }}
            />
          </Stack>
        )}

        {period === 'month' && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Year</InputLabel>
              <Select
                label="Year"
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
              >
                {availableYears.map((year) => (
                  <MenuItem key={year} value={year}>
                    {year}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Month</InputLabel>
              <Select
                label="Month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
              >
                {MONTH_OPTIONS.map((month) => (
                  <MenuItem key={month.value} value={month.value}>
                    {month.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        )}

        {period === 'year' && (
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Year</InputLabel>
            <Select
              label="Year"
              value={yearFilter}
              onChange={(e) => setYearFilter(Number(e.target.value))}
            >
              {availableYears.map((year) => (
                <MenuItem key={year} value={year}>
                  {year}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        {state.filter?.label && (
          <Typography variant="body2" color="text.secondary">
            Showing: {state.filter.label}
          </Typography>
        )}
      </Stack>

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        sx={{ mb: 2 }}
      >
        <TextField
          size="small"
          placeholder="Search by product name, SKU, invoice, or order number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1 }}
        />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Sort</InputLabel>
          <Select label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORT_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {state.loading && state.rows.length === 0 ? (
        <LoadingSkeleton variant="table" />
      ) : state.error ? (
        <EmptyState title="Unable to load GST report" description={state.error} />
      ) : state.rows.length === 0 ? (
        <EmptyState
          title="No GST records found"
          description={
            debouncedSearch
              ? 'No order items match your search for this period.'
              : 'No purchased products found for the selected period.'
          }
        />
      ) : (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell width={56}>S.No</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Invoice Number</TableCell>
                  <TableCell>Order Number</TableCell>
                  <TableCell>Product Name</TableCell>
                  <TableCell>Product SKU / HSN Code</TableCell>
                  <TableCell align="right">Quantity</TableCell>
                  <TableCell align="right">Rate</TableCell>
                  <TableCell align="right">Value</TableCell>
                  <TableCell align="right">Tax</TableCell>
                  <TableCell align="right">Taxable Value</TableCell>
                  <TableCell align="right">SGST %</TableCell>
                  <TableCell align="right">CGST %</TableCell>
                  <TableCell align="right">IGST %</TableCell>
                  <TableCell align="right">SGST Amount</TableCell>
                  <TableCell align="right">CGST Amount</TableCell>
                  <TableCell align="right">IGST Amount</TableCell>
                  <TableCell align="right">Total GST</TableCell>
                  <TableCell align="right">Net Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {state.rows.map((row, index) => (
                  <TableRow key={row.order_item_id || `${row.order_number}-${index}`} hover>
                    <TableCell>{serialOffset + index + 1}</TableCell>
                    <TableCell>{formatDate(row.date)}</TableCell>
                    <TableCell>{row.invoice_number || '—'}</TableCell>
                    <TableCell>{row.order_number || '—'}</TableCell>
                    <TableCell>{row.product_name || '—'}</TableCell>
                    <TableCell>{row.sku_hsn || '—'}</TableCell>
                    <TableCell align="right">{row.quantity ?? '—'}</TableCell>
                    <TableCell align="right">{formatMoney(row.rate)}</TableCell>
                    <TableCell align="right">{formatMoney(row.value)}</TableCell>
                    <TableCell align="right">{formatMoney(row.tax_amount ?? row.total_gst)}</TableCell>
                    <TableCell align="right">{formatMoney(row.taxable_value)}</TableCell>
                    <TableCell align="right">{formatPercent(row.sgst_percent)}</TableCell>
                    <TableCell align="right">{formatPercent(row.cgst_percent)}</TableCell>
                    <TableCell align="right">{formatPercent(row.igst_percent)}</TableCell>
                    <TableCell align="right">{formatMoney(row.sgst_amount)}</TableCell>
                    <TableCell align="right">{formatMoney(row.cgst_amount)}</TableCell>
                    <TableCell align="right">{formatMoney(row.igst_amount)}</TableCell>
                    <TableCell align="right">{formatMoney(row.total_gst)}</TableCell>
                    <TableCell align="right">{formatMoney(row.net_value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
            <TablePagination
              component="div"
              count={state.total}
              page={page}
              onPageChange={(_, nextPage) => setPage(nextPage)}
              rowsPerPage={limit}
              onRowsPerPageChange={(e) => {
                setLimit(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[10, 20, 50]}
            />
          </Box>
        </Paper>
      )}
    </Box>
  );
}
