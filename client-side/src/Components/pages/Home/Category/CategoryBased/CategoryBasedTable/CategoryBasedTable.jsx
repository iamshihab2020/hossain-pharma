/* eslint-disable no-unused-vars */
import {
  Typography,
  Avatar,
  IconButton,
  Tooltip,
  Button,
} from "@material-tailwind/react";
import { useState } from "react";
import useProduct from "../../../../../hooks/useProduct";
import PropTypes from "prop-types";
import Swal from "sweetalert2";
import { useLoaderData, useLocation, useNavigate } from "react-router-dom";
import ProductDetails from "../../../../Shop/ProductDetails/ProductDetails";
import useAxiosSecure from "../../../../../hooks/useAxiosSecure";
import useCart from "../../../../../hooks/useCart";
import useAuth from "../../../../../hooks/useAuth";

const CategoryBasedTable = ({ currentPage, itemsPerPage }) => {
  const { categoryTag } = useLoaderData();
  const [products, loading, error] = useProduct(categoryTag);

  const [selectedProduct, setSelectedProduct] = useState(null);
  const startIdx = (currentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const paginatedProducts = products.slice(startIdx, endIdx);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const axiosSecure = useAxiosSecure();
  const [cart, refetch] = useCart();

  const handleProductClick = (product) => {
    setSelectedProduct(product);
  };

  const handleAddToCart = async (product) => {
    if (user && user.email) {
      const cartItem = {
        id: product._id,
        email: user.email,
        itemName: product.itemName,
        company: product.company,
        perUnitPrice: product.perUnitPrice,
        pricePerPack: product.pricePerPack,
        image: product.image,
        quantity: 1,
      };

      const existingItem = cart.find((item) => item.id === product._id);

      if (existingItem) {
        Swal.fire({
          position: "top-end",
          icon: "info",
          title: `${product.itemName} is already in your cart`,
          showConfirmButton: false,
          timer: 1500,
        });
      } else {
        try {
          const res = await axiosSecure.post("/cart", cartItem);
          console.log("Add to cart response:", res);
          if (res.data.insertedId) {
            Swal.fire({
              position: "top-end",
              icon: "success",
              title: `${product.itemName} added to your cart`,
              showConfirmButton: false,
              timer: 1500,
            });
            refetch();
          } else {
            console.error("Failed to add to cart:", res);
          }
        } catch (error) {
          console.error("Error adding to cart:", error);
        }
      }
    } else {
      Swal.fire({
        title: "You are not Logged In",
        text: "Please login to add to the cart?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#3085d6",
        cancelButtonColor: "#d33",
        confirmButtonText: "Yes, login!",
      }).then((result) => {
        if (result.isConfirmed) {
          //   send the user to the login page
          navigate("/login", { state: { from: location } });
        }
      });
    }
  };

  return (
    <>
      <tbody>
        {paginatedProducts.map((product, index) => {
          const isLast = index === paginatedProducts.length - 1;
          const classes = isLast ? "p-4" : "p-4 border-b border-[#3DBDEC]";
          return (
            <tr key={index}>
              <td className={classes}>
                <div className="flex items-center gap-3">
                  <Avatar src={product.image} size="sm" />
                  <div className="flex flex-col">
                    <Typography
                      variant="small"
                      color="blue-gray"
                      className="font-bold opacity-70"
                    >
                      {product.itemName}
                    </Typography>
                  </div>
                </div>
              </td>

              <td className={classes}>
                <div className="flex flex-col">
                  <Typography
                    variant="small"
                    color="blue-gray"
                    className="font-normal"
                  >
                    {product.company}
                  </Typography>
                </div>
              </td>

              <td className={classes}>
                <div className="flex flex-col">
                  <Typography
                    variant="small"
                    color="blue-gray"
                    className="font-normal"
                  >
                    {product.perUnitPrice}
                  </Typography>
                </div>
              </td>

              <td className={classes}>
                <div className="flex item-start justify-start">
                  <Tooltip content="See more about this product">
                    <IconButton
                      onClick={() => handleProductClick(product)}
                      className="bg-transparent text-[#3DBDEC] shadow-none rounded-full border-2 border-[#3DBDEC]"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2.5}
                        stroke="currentColor"
                        className="size-6"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                        />
                      </svg>
                    </IconButton>
                  </Tooltip>
                </div>
              </td>

              <td className={classes}>
                <Tooltip content="Add to cart">
                  <Button
                    variant="sm"
                    onClick={() => handleAddToCart(product)}
                    className="flex  gap-2 items-center bg-[#1F2B5B] border-2 shadow-none rounded-xl p-3"
                  >
                    Select
                  </Button>
                </Tooltip>
              </td>
            </tr>
          );
        })}
      </tbody>
      {selectedProduct && (
        <ProductDetails
          product={selectedProduct}
          open={Boolean(selectedProduct)}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </>
  );
};

CategoryBasedTable.propTypes = {
  currentPage: PropTypes.number.isRequired,
  itemsPerPage: PropTypes.number.isRequired,
};

export default CategoryBasedTable;
