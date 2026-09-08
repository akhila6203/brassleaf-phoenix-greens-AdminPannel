import AddIcon from '@mui/icons-material/Add';
import {
  Avatar,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCategories } from '../../api/categories';
import { getProducts } from '../../api/products';
import DataTable from '../../components/DataTable';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import useDebounce from '../../hooks/useDebounce';
import { formatDate, formatNumber, formatPriceRange } from '../../utils/format';

export default function ProductsList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [stockStatus, setStockStatus] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(100);
  const [state, setState] = useState({
    rows: [],
    total: 0,
    loading: true,
    error: null,
  });

  useEffect(() => {
    getCategories({ limit: 100, sort: 'name', dir: 'asc' })
      .then((r) => setCategories(r.data.data || []))
      .catch(() => setCategories([]));
  }, []);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    getProducts({
      page: page + 1,
      limit,
      search: debouncedSearch || undefined,
      stock_status: stockStatus || undefined,
      category: category || undefined,
      sort: 'date',
      dir: 'desc',
    })
      .then((r) =>
        setState({
          rows: r.data.data || [],
          total: r.data.total || 0,
          loading: false,
          error: null,
        })
      )
      .catch((e) =>
        setState((s) => ({ ...s, loading: false, error: e.message, rows: [] }))
      );
  }, [page, limit, debouncedSearch, stockStatus, category]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, stockStatus, category]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    {
      id: 'ID',
      label: 'ID',
      width: 80,
      render: (row) => `#${row.ID ?? row.id}`,
    },
    {
      id: 'image',
      label: 'Image',
      width: 64,
      render: (row) => (
        <Avatar
          variant="rounded"
          src={row.image_url || undefined}
          alt={row.name}
          sx={{ width: 40, height: 40 }}
        >
          {(row.name || '?').charAt(0)}
        </Avatar>
      ),
    },
    {
      id: 'name',
      label: 'Name',
      render: (row) => (
        <Box>
          <Box sx={{ fontWeight: 600 }}>{row.name}</Box>
          <Box sx={{ fontSize: 12, color: 'text.secondary' }}>{row.slug}</Box>
        </Box>
      ),
    },
    { id: 'sku', label: 'SKU', render: (row) => row.sku || '—' },
    {
      id: 'type',
      label: 'Type',
      render: (row) => row.product_type || row.type || '—',
    },
    {
      id: 'status',
      label: 'Status',
      render: (row) => <StatusBadge value={row.status || row.post_status} />,
    },
    {
      id: 'categories',
      label: 'Categories',
      render: (row) => row.categories_text || '—',
    },
    {
      id: 'price',
      label: 'Price range',
      render: (row) => formatPriceRange(row.min_price, row.max_price),
    },
    {
      id: 'stock_qty',
      label: 'Stock qty',
      align: 'right',
      render: (row) =>
        row.stock_quantity != null ? formatNumber(row.stock_quantity) : '—',
    },
    {
      id: 'stock',
      label: 'Stock status',
      render: (row) => <StatusBadge value={row.stock_status} />,
    },
    {
      id: 'sales',
      label: 'Sales',
      render: (row) => formatNumber(row.total_sales ?? 0),
    },
    {
      id: 'created',
      label: 'Created',
      render: (row) => formatDate(row.created_at || row.post_date),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Products"
        subtitle={`${formatNumber(state.total)} products`}
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/admin/products/new')}
          >
            Add product
          </Button>
        }
      />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          size="small"
          placeholder="Search name or SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 240 }}
        />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Stock</InputLabel>
          <Select
            label="Stock"
            value={stockStatus}
            onChange={(e) => setStockStatus(e.target.value)}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="instock">In stock</MenuItem>
            <MenuItem value="outofstock">Out of stock</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Category</InputLabel>
          <Select
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <MenuItem value="">All</MenuItem>
            {categories.map((c) => (
              <MenuItem key={c.term_id} value={c.slug}>
                {c.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
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
        onRowClick={(row) => navigate(`/admin/products/${row.ID ?? row.id}`)}
        emptyTitle="No products found"
      />
    </Box>
  );
}
