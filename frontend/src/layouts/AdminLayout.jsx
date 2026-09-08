import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import {
  AppBar,
  Avatar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  LayoutDashboard,
  Package,
  Tags,
  ShoppingCart,
  Users,
  CreditCard,
  TicketPercent,
  Truck,
  Shield,
  Settings,
  FileText,
  Boxes,
  Receipt,
  Leaf,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const DRAWER_WIDTH = 260;

const navItems = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/products', label: 'Products', icon: Package },
  { to: '/admin/categories', label: 'Categories', icon: Tags },
  { to: '/admin/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/admin/customers', label: 'Customers', icon: Users },
  { to: '/admin/payments', label: 'Payments', icon: CreditCard },
  { to: '/admin/reports', label: 'Reports', icon: FileText },
  { to: '/admin/inventory', label: 'Inventory', icon: Boxes },
  { to: '/admin/gst', label: 'GST', icon: Receipt },
  { to: '/admin/coupons', label: 'Coupons', icon: TicketPercent },
  { to: '/admin/shipping', label: 'Shipping', icon: Truck },
  { to: '/admin/users', label: 'Users / Admins', icon: Shield },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

function NavList({ onNavigate }) {
  const location = useLocation();

  return (
    <List sx={{ px: 1.5, py: 1 }}>
      {navItems.map(({ to, label, icon: Icon }) => {
        const active = location.pathname === to || location.pathname.startsWith(`${to}/`);
        return (
          <ListItemButton
            key={to}
            component={NavLink}
            to={to}
            onClick={onNavigate}
            selected={active}
            sx={{
              mb: 0.5,
              borderRadius: 2,
              color: active ? '#5eead4' : '#94a3b8',
              '&.Mui-selected': {
                bgcolor: 'rgba(20, 184, 166, 0.12)',
                color: '#5eead4',
                '&:hover': { bgcolor: 'rgba(20, 184, 166, 0.18)' },
              },
              '&:hover': { bgcolor: 'rgba(148, 163, 184, 0.08)', color: '#e2e8f0' },
            }}
          >
            <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
              <Icon size={18} />
            </ListItemIcon>
            <ListItemText
              primary={label}
              slotProps={{
                primary: {
                  sx: {
                    fontSize: '0.9rem',
                    fontWeight: active ? 600 : 500,
                    color: 'inherit',
                  },
                },
              }}
            />
          </ListItemButton>
        );
      })}
    </List>
  );
}

export default function AdminLayout() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const drawer = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2.5, py: 2.5 }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 2,
            bgcolor: 'primary.main',
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
          }}
        >
          <Leaf size={20} />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 700, color: '#f8fafc', lineHeight: 1.2 }}>
            Brassleaf
          </Typography>
          <Typography variant="caption" sx={{ color: '#64748b' }}>
            Admin
          </Typography>
        </Box>
      </Box>
      <Divider sx={{ borderColor: 'rgba(148,163,184,0.16)' }} />
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        <NavList onNavigate={() => isMobile && setMobileOpen(false)} />
      </Box>
      <Box sx={{ p: 2, borderTop: '1px solid rgba(148,163,184,0.16)' }}>
        <Typography variant="caption" sx={{ color: '#64748b' }}>
          Ecommerce control panel
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        color="inherit"
        sx={{
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { md: `${DRAWER_WIDTH}px` },
        }}
      >
        <Toolbar>
          {isMobile && (
            <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 600, fontSize: '1rem' }}>
            Brassleaf Admin
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
              <Typography variant="body2" fontWeight={600}>
                {user?.display_name || user?.username || user?.name || 'Admin'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user?.email || user?.role || 'Signed in'}
              </Typography>
            </Box>
            <Avatar
              sx={{
                width: 36,
                height: 36,
                bgcolor: 'primary.main',
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {(user?.display_name || user?.username || 'A').charAt(0).toUpperCase()}
            </Avatar>
            <IconButton onClick={handleLogout} title="Sign out" size="small">
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          minHeight: '100vh',
        }}
      >
        <Toolbar />
        <Box sx={{ p: { xs: 2, md: 3 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}



// import MenuIcon from '@mui/icons-material/Menu';
// import LogoutIcon from '@mui/icons-material/Logout';
// import {
//   AppBar,
//   Avatar,
//   Box,
//   Divider,
//   Drawer,
//   IconButton,
//   List,
//   ListItemButton,
//   ListItemIcon,
//   ListItemText,
//   Toolbar,
//   Typography,
//   useMediaQuery,
// } from '@mui/material';
// import { useTheme } from '@mui/material/styles';
// import {
//   LayoutDashboard,
//   Package,
//   Tags,
//   ShoppingCart,
//   Users,
//   CreditCard,
//   TicketPercent,
//   Truck,
//   Shield,
//   Settings,
//   FileText,
//   Leaf,
// } from 'lucide-react';
// import { useState } from 'react';
// import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
// import { useAuth } from '../context/AuthContext';

// const DRAWER_WIDTH = 260;

// const navItems = [
//   { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
//   { to: '/admin/products', label: 'Products', icon: Package },
//   { to: '/admin/categories', label: 'Categories', icon: Tags },
//   { to: '/admin/orders', label: 'Orders', icon: ShoppingCart },
//   { to: '/admin/customers', label: 'Customers', icon: Users },
//   { to: '/admin/payments', label: 'Payments', icon: CreditCard },
//   { to: '/admin/reports', label: 'Reports', icon: FileText },
//   { to: '/admin/coupons', label: 'Coupons', icon: TicketPercent },
//   { to: '/admin/shipping', label: 'Shipping', icon: Truck },
//   { to: '/admin/users', label: 'Users / Admins', icon: Shield },
//   { to: '/admin/settings', label: 'Settings', icon: Settings },
// ];

// function NavList({ onNavigate }) {
//   const location = useLocation();

//   return (
//     <List sx={{ px: 1.5, py: 1 }}>
//       {navItems.map(({ to, label, icon: Icon }) => {
//         const active = location.pathname === to || location.pathname.startsWith(`${to}/`);
//         return (
//           <ListItemButton
//             key={to}
//             component={NavLink}
//             to={to}
//             onClick={onNavigate}
//             selected={active}
//             sx={{
//               mb: 0.5,
//               borderRadius: 2,
//               color: active ? '#5eead4' : '#94a3b8',
//               '&.Mui-selected': {
//                 bgcolor: 'rgba(20, 184, 166, 0.12)',
//                 color: '#5eead4',
//                 '&:hover': { bgcolor: 'rgba(20, 184, 166, 0.18)' },
//               },
//               '&:hover': { bgcolor: 'rgba(148, 163, 184, 0.08)', color: '#e2e8f0' },
//             }}
//           >
//             <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
//               <Icon size={18} />
//             </ListItemIcon>
//             <ListItemText
//               primary={label}
//               slotProps={{
//                 primary: {
//                   sx: {
//                     fontSize: '0.9rem',
//                     fontWeight: active ? 600 : 500,
//                     color: 'inherit',
//                   },
//                 },
//               }}
//             />
//           </ListItemButton>
//         );
//       })}
//     </List>
//   );
// }

// export default function AdminLayout() {
//   const theme = useTheme();
//   const isMobile = useMediaQuery(theme.breakpoints.down('md'));
//   const [mobileOpen, setMobileOpen] = useState(false);
//   const { user, logout } = useAuth();
//   const navigate = useNavigate();

//   const handleLogout = () => {
//     logout();
//     navigate('/login', { replace: true });
//   };

//   const drawer = (
//     <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
//       <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2.5, py: 2.5 }}>
//         <Box
//           sx={{
//             width: 36,
//             height: 36,
//             borderRadius: 2,
//             bgcolor: 'primary.main',
//             display: 'grid',
//             placeItems: 'center',
//             color: '#fff',
//           }}
//         >
//           <Leaf size={20} />
//         </Box>
//         <Box>
//           <Typography sx={{ fontWeight: 700, color: '#f8fafc', lineHeight: 1.2 }}>
//             Brassleaf
//           </Typography>
//           <Typography variant="caption" sx={{ color: '#64748b' }}>
//             Admin
//           </Typography>
//         </Box>
//       </Box>
//       <Divider sx={{ borderColor: 'rgba(148,163,184,0.16)' }} />
//       <Box sx={{ flex: 1, overflowY: 'auto' }}>
//         <NavList onNavigate={() => isMobile && setMobileOpen(false)} />
//       </Box>
//       <Box sx={{ p: 2, borderTop: '1px solid rgba(148,163,184,0.16)' }}>
//         <Typography variant="caption" sx={{ color: '#64748b' }}>
//           Ecommerce control panel
//         </Typography>
//       </Box>
//     </Box>
//   );

//   return (
//     <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
//       <AppBar
//         position="fixed"
//         color="inherit"
//         sx={{
//           width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
//           ml: { md: `${DRAWER_WIDTH}px` },
//         }}
//       >
//         <Toolbar>
//           {isMobile && (
//             <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }}>
//               <MenuIcon />
//             </IconButton>
//           )}
//           <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 600, fontSize: '1rem' }}>
//             Brassleaf Admin
//           </Typography>
//           <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
//             <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
//               <Typography variant="body2" fontWeight={600}>
//                 {user?.display_name || user?.username || user?.name || 'Admin'}
//               </Typography>
//               <Typography variant="caption" color="text.secondary">
//                 {user?.email || user?.role || 'Signed in'}
//               </Typography>
//             </Box>
//             <Avatar
//               sx={{
//                 width: 36,
//                 height: 36,
//                 bgcolor: 'primary.main',
//                 fontSize: 14,
//                 fontWeight: 700,
//               }}
//             >
//               {(user?.display_name || user?.username || 'A').charAt(0).toUpperCase()}
//             </Avatar>
//             <IconButton onClick={handleLogout} title="Sign out" size="small">
//               <LogoutIcon fontSize="small" />
//             </IconButton>
//           </Box>
//         </Toolbar>
//       </AppBar>

//       <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
//         <Drawer
//           variant="temporary"
//           open={mobileOpen}
//           onClose={() => setMobileOpen(false)}
//           ModalProps={{ keepMounted: true }}
//           sx={{
//             display: { xs: 'block', md: 'none' },
//             '& .MuiDrawer-paper': { width: DRAWER_WIDTH },
//           }}
//         >
//           {drawer}
//         </Drawer>
//         <Drawer
//           variant="permanent"
//           open
//           sx={{
//             display: { xs: 'none', md: 'block' },
//             '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
//           }}
//         >
//           {drawer}
//         </Drawer>
//       </Box>

//       <Box
//         component="main"
//         sx={{
//           flexGrow: 1,
//           width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
//           minHeight: '100vh',
//         }}
//       >
//         <Toolbar />
//         <Box sx={{ p: { xs: 2, md: 3 } }}>
//           <Outlet />
//         </Box>
//       </Box>
//     </Box>
//   );
// }
