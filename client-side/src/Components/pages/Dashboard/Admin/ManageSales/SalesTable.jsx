import PropTypes from "prop-types";
import { Typography } from "@material-tailwind/react";

const SalesTable = ({
  payments,
  currentPage,
  itemsPerPage,
  products,
}) => {
  const startIdx = (currentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const paginatedPayments = payments.slice(startIdx, endIdx);

  const renderProductNames = (cartItems, products) => {
    if (!cartItems || !products) return null;

    return cartItems.map((item, idx) => {
      const product = products.find((p) => p._id === item.productId);
      return (
        <div key={idx}>
          {product
            ? `${product.itemName} (Quantity: ${item.quantity})`
            : "Unknown Product"}
        </div>
      );
    });
  };

  const renderSellerEmail = (cartItems, products) => {
    if (!cartItems || !products) return null;

    return cartItems.map((item, idx) => {
      const product = products.find((p) => p._id === item.productId);
      return (
        <div key={idx}>
          {product ? `${product.sellerEmail}` : "Unknown Product"}
        </div>
      );
    });
  };

  return (
    <tbody>
      {paginatedPayments.map((payment, index) => {
        const isLast = index === paginatedPayments.length - 1;
        const classes = isLast ? "p-4" : "p-4 border-b border-[#3DBDEC]";
        return (
          <tr key={index}>
            <td className={classes}>
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <Typography variant="small" className="font-bold opacity-70">
                    {index + 1}
                  </Typography>
                </div>
              </div>
            </td>

            <td className={classes}>
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <Typography variant="small">{payment._id}</Typography>
                </div>
              </div>
            </td>

            <td className={classes}>
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <Typography variant="small">{payment.email}</Typography>
                </div>
              </div>
            </td>

            <td className={classes}>
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <Typography variant="small">
                    {renderSellerEmail(payment.cartItems, products)}
                  </Typography>
                </div>
              </div>
            </td>

            <td className={classes}>
              <div className="flex flex-col">
                <Typography variant="small" className="font-normal">
                  {renderProductNames(payment.cartItems, products)}
                </Typography>
              </div>
            </td>

            <td className={classes}>
              <div className="flex flex-col">
                <Typography variant="small" className="font-normal">
                  {payment.transactionId}
                </Typography>
              </div>
            </td>
            <td className={classes}>
              <div className="flex flex-col">
                <Typography variant="small" className="font-normal">
                  {payment.price} $
                </Typography>
              </div>
            </td>
          </tr>
        );
      })}
    </tbody>
  );
};

SalesTable.propTypes = {
  payments: PropTypes.array.isRequired,
  currentPage: PropTypes.number.isRequired,
  itemsPerPage: PropTypes.number.isRequired,
  refetch: PropTypes.func.isRequired,
  products: PropTypes.array.isRequired,
};

export default SalesTable;
