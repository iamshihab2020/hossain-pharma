import PropTypes from "prop-types";
import { Card, CardBody, Typography } from "@material-tailwind/react";
import useAuth from "../../../../hooks/useAuth";

const SellerHomeDetails = ({
  payments,
  products,
}) => {
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


  const totalAccumulatedPrice = payments.reduce((acc, payment) => {
    const { totalPrice } = renderProductDetails(payment.cartItems, products);
    return acc + totalPrice;
  }, 0);

  const { totalAccepted, totalPending } = payments.reduce(
    (acc, payment) => {
      if (payment.status === "accepted") acc.totalAccepted += 1;
      if (payment.status === "pending") acc.totalPending += 1;
      return acc;
    },
    { totalAccepted: 0, totalPending: 0 }
  );

  return (
    <>
      <div className="flex items-center justify-start flex-wrap gap-5">
        {/* revenue */}
        <Card className="mt-6 w-64 flex flex-col items-center justify-center bg-[#1F2B5B] text-[#3DBDEC]">
          <CardBody>
            <Typography variant="lead">Total Revenue</Typography>
            <Typography
              variant="h2"
              color="blue-gray"
              className="mb-2 text-[#3DBDEC] text-center"
            >
              {totalAccumulatedPrice} $
            </Typography>
          </CardBody>
        </Card>

        {/* Payment Pain */}
        <Card className="mt-6 w-64 flex flex-col items-center justify-center bg-[#1F2B5B] text-[#3DBDEC]">
          <CardBody>
            <Typography variant="lead">Payment Paid Total</Typography>
            <Typography
              variant="h2"
              color="blue-gray"
              className="mb-2 text-[#3DBDEC] text-center"
            >
              {totalAccepted}
            </Typography>
          </CardBody>
        </Card>

        {/* Payment Pending */}
        <Card className="mt-6 w-64 flex flex-col items-center justify-center bg-[#1F2B5B] text-[#3DBDEC]">
          <CardBody>
            <Typography variant="lead">Payment Pending Total</Typography>
            <Typography
              variant="h2"
              color="blue-gray"
              className="mb-2 text-[#3DBDEC] text-center"
            >
              {totalPending}
            </Typography>
          </CardBody>
        </Card>
      </div>
    </>
  );
};

SellerHomeDetails.propTypes = {
  payments: PropTypes.array.isRequired,
  currentPage: PropTypes.number.isRequired,
  itemsPerPage: PropTypes.number.isRequired,
  products: PropTypes.array.isRequired,
};

export default SellerHomeDetails;
