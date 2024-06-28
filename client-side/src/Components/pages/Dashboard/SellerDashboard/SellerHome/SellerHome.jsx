import Dash_Navbar from "../../../../layout/Dashboard/Dash_Navbar/Dash_Navbar";
import SyncHelmet from "../../../Shared/Helmet/SyncHelmet";
import usePayments from "../../../../hooks/usePayments";
import useProduct from "../../../../hooks/useProduct";
import useAuth from "../../../../hooks/useAuth";
import SellerHomeDetails from "./SellerHomeDetails";


const SellerHome = () => {;
  const [payments, refetch] = usePayments();
  const [products] = useProduct();
  const { user } = useAuth();

  const sellerPayments = payments.filter(
    (payment) =>
      payment.cartItems &&
      payment.cartItems.some((item) => {
        const product = products.find((p) => p._id === item.productId);
        return product && product.sellerEmail === user.email;
      })
  );

  return (
    <div>
      <SyncHelmet loc={"Seller Home"} />
      <Dash_Navbar title={"Seller Home"} />
      <div>
        <div className="pb-14">
          <SellerHomeDetails
            payments={sellerPayments}
            refetch={refetch}
            products={products}
          />
        </div>
      </div>
    </div>
  );
};

export default SellerHome;
