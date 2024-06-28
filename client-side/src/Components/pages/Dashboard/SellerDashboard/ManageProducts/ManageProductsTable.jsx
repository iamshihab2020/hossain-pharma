import { useState } from "react";
import PropTypes from "prop-types";
import Swal from "sweetalert2";
import {
  Typography,
  Avatar,
  IconButton,
  Tooltip,
} from "@material-tailwind/react";
import ProductDetails from "../../../Shop/ProductDetails/ProductDetails";
import useAxiosSecure from "../../../../hooks/useAxiosSecure";


const ManageProductsTable = ({
  products,
  currentPage,
  itemsPerPage,
  refetch,
}) => {

  const [selectedProduct, setSelectedProduct] = useState(null);
  const startIdx = (currentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const paginatedProducts = products.slice(startIdx, endIdx);
  const axiosSecure = useAxiosSecure();

  const handleProductClick = (product) => {
    setSelectedProduct(product);
  };


  const handleDeleteProduct = (id) => {
    Swal.fire({
      title: "Are you sure?",
      text: "You won't be able to revert this!",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: "Yes, delete it!",
    }).then((result) => {
      if (result.isConfirmed) {
        axiosSecure.delete(`/products/seller/${id}`).then((res) => {
          if (res.data.deletedCount > 0) {
            refetch();
            Swal.fire({
              title: "Deleted!",
              text: "Your product has been deleted from website.",
              icon: "success",
              confirmButtonColor: "#3085d6",
            });
          }
        });
      }
    });
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
                    $ {product.perUnitPrice}
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
                    $ {product.pricePerPack}
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
                <div className="flex item-start justify-start">
                  <Tooltip content="Delete this product">
                    <IconButton
                      onClick={() => handleDeleteProduct(product._id)}
                      className="bg-transparent text-red-500 shadow-none rounded-full border-2 border-red-500"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="size-6"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                        />
                      </svg>
                    </IconButton>
                  </Tooltip>
                </div>
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

ManageProductsTable.propTypes = {
  products: PropTypes.array.isRequired,
  currentPage: PropTypes.number.isRequired,
  itemsPerPage: PropTypes.number.isRequired,
  refetch: PropTypes.func.isRequired,
};

export default ManageProductsTable;
