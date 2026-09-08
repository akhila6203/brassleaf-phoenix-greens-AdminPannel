import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material';
import EmptyState from './EmptyState';
import LoadingSkeleton from './LoadingSkeleton';

/**
 * columns: [{ id, label, align?, render?(row), width? }]
 */
export default function DataTable({
  columns,
  rows = [],
  loading = false,
  error = null,
  page = 0,
  rowsPerPage = 20,
  total = 0,
  onPageChange,
  onRowsPerPageChange,
  onRowClick,
  emptyTitle = 'No records found',
  emptyDescription,
  stickyHeader = true,
  rowsPerPageOptions = [10, 20, 50, 100],
}) {
  if (loading) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <LoadingSkeleton rows={8} />
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper variant="outlined">
        <EmptyState error title="Failed to load" description={error} />
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <TableContainer>
        <Table stickyHeader={stickyHeader} size="medium">
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell key={col.id} align={col.align || 'left'} sx={{ width: col.width }}>
                  {col.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} sx={{ p: 0, border: 0 }}>
                  <EmptyState title={emptyTitle} description={emptyDescription} />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, idx) => (
                <TableRow
                  key={row.id ?? row.ID ?? row.term_id ?? idx}
                  hover={Boolean(onRowClick)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  sx={{ cursor: onRowClick ? 'pointer' : 'default' }}
                >
                  {columns.map((col) => (
                    <TableCell key={col.id} align={col.align || 'left'}>
                      {col.render ? (
                        col.render(row)
                      ) : (
                        <Typography variant="body2">{row[col.id] ?? '—'}</Typography>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {onPageChange && (
        <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
          <TablePagination
            component="div"
            count={total}
            page={Math.max(0, page)}
            onPageChange={(_, p) => onPageChange(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) =>
              onRowsPerPageChange?.(parseInt(e.target.value, 10))
            }
            rowsPerPageOptions={rowsPerPageOptions}
          />
        </Box>
      )}
    </Paper>
  );
}
