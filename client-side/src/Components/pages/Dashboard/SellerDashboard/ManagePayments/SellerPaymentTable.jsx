import PropTypes from "prop-types";
import { Typography, Chip } from "@material-tailwind/react";
import useAuth from "../../../../hooks/useAuth";

const SellerPaymentTable = ({
  payments,
  currentPage,
  itemsPerPage,
  products,
}) => {
  const startIdx = (currentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const paginatedPayments = payments.slice(startIdx, endIdx);
  const { user } = useAuth();

  const renderProductDetails = (cartItems, products) => {
    if (!cartItems || !products) return { productDetails: null, totalPrice: 0 };

    let totalPrice = 0;

    const productDetails = cartItems.map((item, idx) => {
      const product = products.find((p) => p._id === item.productId);
      if (product && product.sellerEmail === user.email) {
        const itemTotalPrice = product.pricePerPack * item.quantity;
        totalPrice += itemTotalPrice;
        return (
          <div key={idx}>
            {`${product.itemName} (Quantity: ${item.quantity}) - Total Price: ${itemTotalPrice}`}
          </div>
        );
      }
      return null;
    });

    return { productDetails, totalPrice };
  };

  const renderSellerEmail = (cartItems, products) => {
    if (!cartItems || !products) return null;

    return cartItems.map((item, idx) => {
      const product = products.find((p) => p._id === item.productId);
      return (
        product &&
        product.sellerEmail === user.email && (
          <div key={idx}>{product.sellerEmail}</div>
        )
      );
    });
  };

  const renderStatusChip = (status) => {
    const statusColor =
      {
        pending: "orange",
        accepted: "green",
      }[status] || "green";

    return (
      <Chip
        value={status}
        size="sm"
        color={statusColor}
        className="rounded-full text-center"
      />
    );
  };



  return (
    <>
      <tbody>
        {paginatedPayments.map((payment, index) => {
          const isLast = index === paginatedPayments.length - 1;
          const classes = isLast ? "p-4" : "p-4 border-b border-[#3DBDEC]";
          const { productDetails, totalPrice } = renderProductDetails(
            payment.cartItems,
            products
          );

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
                    {productDetails}
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
                    {totalPrice} $
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
                    <div className="w-20">{renderStatusChip(payment.status)}</div>
                  </Typography>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </>
  );
};

SellerPaymentTable.propTypes = {
  payments: PropTypes.array.isRequired,
  currentPage: PropTypes.number.isRequired,
  itemsPerPage: PropTypes.number.isRequired,
  products: PropTypes.array.isRequired,
};

export default SellerPaymentTable;
