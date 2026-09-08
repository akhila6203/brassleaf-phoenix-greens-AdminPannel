import { Navigate, Route, Routes } from 'react-router-dom';
import AdminLayout from '../layouts/AdminLayout';
import Login from '../pages/Login';
import Dashboard from '../pages/Dashboard';
import ProductsList from '../pages/products/ProductsList';
import ProductForm from '../pages/products/ProductForm';
import ProductDetails from '../pages/products/ProductDetails';
import CategoriesList from '../pages/categories/CategoriesList';
import CategoryForm from '../pages/categories/CategoryForm';
import CategoryDetails from '../pages/categories/CategoryDetails';
import OrdersList from '../pages/orders/OrdersList';
import OrderDetails from '../pages/orders/OrderDetails';
import CustomersList from '../pages/customers/CustomersList';
import CustomerForm from '../pages/customers/CustomerForm';
import CustomerDetails from '../pages/customers/CustomerDetails';
import Payments from '../pages/Payments';
import PaymentDetails from '../pages/payments/PaymentDetails';
import CouponsList from '../pages/coupons/CouponsList';
import CouponForm from '../pages/coupons/CouponForm';
import Shipping from '../pages/Shipping';
import UsersList from '../pages/users/UsersList';
import UserDetails from '../pages/users/UserDetails';
import UserForm from '../pages/users/UserForm';
import Reports from '../pages/Reports';
import Inventory from '../pages/Inventory';
import Gst from '../pages/Gst';
import Settings from '../pages/Settings';
import ProtectedRoute from './ProtectedRoute';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />

          <Route path="products" element={<ProductsList />} />
          <Route path="products/new" element={<ProductForm />} />
          <Route path="products/:id" element={<ProductDetails />} />
          <Route path="products/:id/edit" element={<ProductForm />} />

          <Route path="categories" element={<CategoriesList />} />
          <Route path="categories/new" element={<CategoryForm />} />
          <Route path="categories/:id" element={<CategoryDetails />} />
          <Route path="categories/:id/edit" element={<CategoryForm />} />

          <Route path="orders" element={<OrdersList />} />
          <Route path="orders/:id" element={<OrderDetails />} />

          <Route path="customers" element={<CustomersList />} />
          <Route path="customers/new" element={<CustomerForm />} />
          <Route path="customers/:id" element={<CustomerDetails />} />
          <Route path="customers/:id/edit" element={<CustomerForm />} />

          <Route path="payments" element={<Payments />} />
          <Route path="payments/:id" element={<PaymentDetails />} />

          <Route path="reports" element={<Reports />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="gst" element={<Gst />} />

          <Route path="coupons" element={<CouponsList />} />
          <Route path="coupons/new" element={<CouponForm />} />
          <Route path="coupons/:id/edit" element={<CouponForm />} />

          <Route path="shipping" element={<Shipping />} />

          <Route path="users" element={<UsersList />} />
          <Route path="users/new" element={<UserForm />} />
          <Route path="users/:id" element={<UserDetails />} />
          <Route path="users/:id/edit" element={<UserForm />} />

          <Route path="settings" element={<Settings />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
    </Routes>
  );
}




// import { Navigate, Route, Routes } from 'react-router-dom';
// import AdminLayout from '../layouts/AdminLayout';
// import Login from '../pages/Login';
// import Dashboard from '../pages/Dashboard';
// import ProductsList from '../pages/products/ProductsList';
// import ProductForm from '../pages/products/ProductForm';
// import ProductDetails from '../pages/products/ProductDetails';
// import CategoriesList from '../pages/categories/CategoriesList';
// import CategoryForm from '../pages/categories/CategoryForm';
// import CategoryDetails from '../pages/categories/CategoryDetails';
// import OrdersList from '../pages/orders/OrdersList';
// import OrderDetails from '../pages/orders/OrderDetails';
// import CustomersList from '../pages/customers/CustomersList';
// import CustomerForm from '../pages/customers/CustomerForm';
// import CustomerDetails from '../pages/customers/CustomerDetails';
// import Payments from '../pages/Payments';
// import PaymentDetails from '../pages/payments/PaymentDetails';
// import CouponsList from '../pages/coupons/CouponsList';
// import CouponForm from '../pages/coupons/CouponForm';
// import Shipping from '../pages/Shipping';
// import UsersList from '../pages/users/UsersList';
// import UserDetails from '../pages/users/UserDetails';
// import UserForm from '../pages/users/UserForm';
// import Reports from '../pages/Reports';
// import Settings from '../pages/Settings';
// import ProtectedRoute from './ProtectedRoute';

// export default function AppRoutes() {
//   return (
//     <Routes>
//       <Route path="/login" element={<Login />} />
//       <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />

//       <Route element={<ProtectedRoute />}>
//         <Route path="/admin" element={<AdminLayout />}>
//           <Route index element={<Navigate to="dashboard" replace />} />
//           <Route path="dashboard" element={<Dashboard />} />

//           <Route path="products" element={<ProductsList />} />
//           <Route path="products/new" element={<ProductForm />} />
//           <Route path="products/:id" element={<ProductDetails />} />
//           <Route path="products/:id/edit" element={<ProductForm />} />

//           <Route path="categories" element={<CategoriesList />} />
//           <Route path="categories/new" element={<CategoryForm />} />
//           <Route path="categories/:id" element={<CategoryDetails />} />
//           <Route path="categories/:id/edit" element={<CategoryForm />} />

//           <Route path="orders" element={<OrdersList />} />
//           <Route path="orders/:id" element={<OrderDetails />} />

//           <Route path="customers" element={<CustomersList />} />
//           <Route path="customers/new" element={<CustomerForm />} />
//           <Route path="customers/:id" element={<CustomerDetails />} />
//           <Route path="customers/:id/edit" element={<CustomerForm />} />

//           <Route path="payments" element={<Payments />} />
//           <Route path="payments/:id" element={<PaymentDetails />} />

//           <Route path="reports" element={<Reports />} />

//           <Route path="coupons" element={<CouponsList />} />
//           <Route path="coupons/new" element={<CouponForm />} />
//           <Route path="coupons/:id/edit" element={<CouponForm />} />

//           <Route path="shipping" element={<Shipping />} />

//           <Route path="users" element={<UsersList />} />
//           <Route path="users/new" element={<UserForm />} />
//           <Route path="users/:id" element={<UserDetails />} />
//           <Route path="users/:id/edit" element={<UserForm />} />

//           <Route path="settings" element={<Settings />} />
//         </Route>
//       </Route>

//       <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
//     </Routes>
//   );
// }
