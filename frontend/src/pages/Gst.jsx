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
  TableRow,
  TextField,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getGstReport } from '../api/gst';
import EmptyState from '../components/EmptyState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageHeader from '../components/PageHeader';
import { useSnackbar } from '../context/SnackbarContext';
import useDebounce from '../hooks/useDebounce';
import { downloadGstExcel } from '../utils/gstExcelExport';
import { formatCurrency } from '../utils/format';

const SORT_OPTIONS = [
  { value: 'name_asc', label: 'Product Name A-Z' },
  { value: 'price_low', label: 'Price Low-High' },
  { value: 'price_high', label: 'Price High-Low' },
  { value: 'gst_low', label: 'GST Low-High' },
  { value: 'gst_high', label: 'GST High-Low' },
];

export default function Gst() {
  const { showToast } = useSnackbar();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name_asc');
  const [downloading, setDownloading] = useState(false);
  const [state, setState] = useState({
    loading: true,
    error: null,
    items: [],
  });

  const debouncedSearch = useDebounce(search, 350);

  const queryParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      sort,
    }),
    [debouncedSearch, sort]
  );

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));

    getGstReport(queryParams)
      .then((res) => {
        setState({
          loading: false,
          error: null,
          items: res.data.items || [],
        });
      })
      .catch((e) => {
        setState({
          loading: false,
          error: e.message,
          items: [],
        });
      });
  }, [queryParams]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDownloadExcel = async () => {
    if (state.loading) return;

    setDownloading(true);
    try {
      await downloadGstExcel({ items: state.items });
      showToast('GST sheet downloaded', 'success');
    } catch (e) {
      showToast(e.message || 'Unable to download GST sheet', 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="GST"
        subtitle="Product-wise GST details"
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

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        sx={{ mb: 2 }}
      >
        <TextField
          size="small"
          placeholder="Search by product name, SKU, or size…"
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

      {state.loading ? (
        <LoadingSkeleton variant="table" />
      ) : state.error ? (
        <EmptyState title="Unable to load GST report" description={state.error} />
      ) : state.items.length === 0 ? (
        <EmptyState
          title="No products available"
          description={
            debouncedSearch
              ? 'No products match your search.'
              : 'There are no products in the catalog yet.'
          }
        />
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell width={72}>S.No</TableCell>
                <TableCell>Product Name</TableCell>
                <TableCell>SKU</TableCell>
                <TableCell>Size / Variant</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell align="right">GST</TableCell>
                <TableCell align="right">Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {state.items.map((item, index) => (
                <TableRow
                  key={`${item.product_name}-${item.sku}-${item.variant_label}-${item.total}-${index}`}
                  hover
                >
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>{item.product_name}</TableCell>
                  <TableCell>{item.sku || '—'}</TableCell>
                  <TableCell>{item.variant_label || '—'}</TableCell>
                  <TableCell align="right">{formatCurrency(item.price)}</TableCell>
                  <TableCell align="right">{formatCurrency(item.gst)}</TableCell>
                  <TableCell align="right">{formatCurrency(item.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
