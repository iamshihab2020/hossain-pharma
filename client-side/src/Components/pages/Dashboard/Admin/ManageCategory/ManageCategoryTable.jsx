import { useState } from "react";
import PropTypes from "prop-types";
import ProductDetails from "../../../Shop/ProductDetails/ProductDetails";

import {
  Typography,
  Avatar,
  IconButton,
  Tooltip,
} from "@material-tailwind/react";
import EditCategory from "./EditCategory";

const ManageCategoryTable = ({ products, currentPage, itemsPerPage }) => {
  
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [editCategory, setEditCategory] = useState(null);
  const startIdx = (currentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const paginatedProducts = products.slice(startIdx, endIdx);


  const handleProductClick = (product) => {
    setSelectedProduct(product);
  };

  const handleEditClick = (product) => {
    setEditCategory(product);
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
                    {product.category}
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
                <Tooltip content="Update category">
                  <IconButton
                    variant="sm"
                    onClick={() => handleEditClick(product)}
                    className="bg-transparent text-[#1F2B5B] shadow-none rounded-full border-2 border-[#1F2B5B]"
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
                        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                      />
                    </svg>
                  </IconButton>
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
      {editCategory && (
        <EditCategory
          product={editCategory}
          open={Boolean(editCategory)}
          onClose={() => setEditCategory(null)}
        />
      )}
    </>
  );
};

ManageCategoryTable.propTypes = {
  products: PropTypes.array.isRequired,
  currentPage: PropTypes.number.isRequired,
  itemsPerPage: PropTypes.number.isRequired,
};

export default ManageCategoryTable;
