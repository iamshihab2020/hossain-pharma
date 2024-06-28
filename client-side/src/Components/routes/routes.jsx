import { createBrowserRouter } from "react-router-dom";
import Main from "../layout/Main";
import ErrorPage from "../pages/ErrorPage/ErrorPage";
import Home from "../pages/Home/Home/Home";

import Login from "../pages/Auth/Login/Login";
import SignUp from "../pages/Auth/SignUp/SignUp";
import Shop from "../pages/Shop/Shop/Shop";
import ProductDetails from "../pages/Shop/ProductDetails/ProductDetails";
import Cart from "../pages/Cart/Cart/Cart";
import CategoryBased from "../pages/Home/Category/CategoryBased/CategoryBased/CategoryBased";
import PrivateRoute from "./PrivateRoute";
import Dashboard from "../layout/Dashboard/Dashboard/Dashboard";
import AdminRoute from "./AdminRoute";
import AddProducts from "../pages/Dashboard/SellerDashboard/AddProduct/AddProducts";
import SellerRoute from "./SellerRoute";
import EditProfile from "../pages/Auth/EditProfile/EditProfile";
import ManageProducts from "../pages/Dashboard/SellerDashboard/ManageProducts/ManageProducts";
import AllUsers from "../pages/Dashboard/Admin/AllUsers/AllUsers";
import SellerAds from "../pages/Dashboard/SellerDashboard/SellerAds/SellerAds";
import ManageAdsAdmin from "../pages/Dashboard/Admin/ManageAdsAdmin/ManageAdsAdmin";
import ManageCategory from "../pages/Dashboard/Admin/ManageCategory/ManageCategory";
import Payment from "../pages/Dashboard/Payment/Payment";
import PaymentHistory from "../pages/Dashboard/PaymentHistory/PaymentHistory";
import AdminHome from "../pages/Dashboard/Admin/AdminHome/AdminHome";
import SellerHome from "../pages/Dashboard/SellerDashboard/SellerHome/SellerHome";
import ManagePayment from "../pages/Dashboard/Admin/ManagePayment/ManagePayment";
import ManageSales from "../pages/Dashboard/Admin/ManageSales/ManageSales";
import SellerManagePayments from "../pages/Dashboard/SellerDashboard/ManagePayments/SellerManagePayments";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Main />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: "/",
        element: <Home />,
      },
      {
        path: "/category/:categoryTag",
        element: <CategoryBased />,
        loader: async ({ params }) => {
          const response = await fetch(
            "https://hossain-farma-server.vercel.app/category"
          );
          const categories = await response.json();
          const category = categories.find(
            (cat) => cat.categoryTag === params.categoryTag
          );
          return {
            categoryTag: params.categoryTag,
            categoryName: category ? category.categoryName : params.categoryTag,
          };
        },
      },
      {
        path: "/login",
        element: <Login />,
      },
      {
        path: "/signup",
        element: <SignUp />,
      },
      {
        path: "/edit-profile",
        element: <EditProfile />,
      },
      {
        path: "/shop",
        element: <Shop />,
      },
      {
        path: "/shop/:id",
        element: <ProductDetails />,
        loader: ({ params }) =>
          fetch(
            `https://hossain-farma-server.vercel.app/products/${params.id}`
          ),
      },
      {
        path: "/cart",
        element: (
          <PrivateRoute>
            <Cart />
          </PrivateRoute>
        ),
      },
      {
        path: "/user/payment",
        element: <Payment />,
      },
      // {
      //   path: "/invoice",
      //   element: <Invoice />,
      // },
    ],
  },

  //Dashboard routes
  {
    path: "/dashboard",
    element: (
      <PrivateRoute>
        <Dashboard />
      </PrivateRoute>
    ),
    errorElement: <ErrorPage />,
    children: [
      {
        path: "user/paymentHistory",
        element: <PaymentHistory />,
      },
      {
        path: "user/paymentHistory",
        element: <PaymentHistory />,
      },
      //admin routes
      {
        path: "adminHome",
        element: (
          <AdminRoute>
            <AdminHome />
          </AdminRoute>
        ),
      },
      {
        path: "allUsers",
        element: (
          <AdminRoute>
            <AllUsers />
          </AdminRoute>
        ),
      },
      {
        path: "managePayment",
        element: (
          <AdminRoute>
            <ManagePayment />
          </AdminRoute>
        ),
      },
      {
        path: "manageSales",
        element: (
          <AdminRoute>
            <ManageSales />
          </AdminRoute>
        ),
      },
      {
        path: "admin/manageAds",
        element: (
          <AdminRoute>
            <ManageAdsAdmin />
          </AdminRoute>
        ),
      },
      {
        path: "manageCategory",
        element: (
          <AdminRoute>
            <ManageCategory />
          </AdminRoute>
        ),
      },

      //Seller Routes
      {
        path: "sellerHome",
        element: (
          <SellerRoute>
            <SellerHome />
          </SellerRoute>
        ),
      },
      {
        path: "addProducts",
        element: (
          <SellerRoute>
            <AddProducts />
          </SellerRoute>
        ),
      },
      {
        path: "manageProducts",
        element: (
          <SellerRoute>
            <ManageProducts />
          </SellerRoute>
        ),
      },
      {
        path: "seller/managePayment",
        element: (
          <SellerRoute>
            <SellerManagePayments />
          </SellerRoute>
        ),
      },
      {
        path: "seller/ads",
        element: (
          <SellerRoute>
            <SellerAds />
          </SellerRoute>
        ),
      },
    ],
  },
]);

export default router;
