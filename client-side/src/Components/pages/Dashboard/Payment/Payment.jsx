import SyncHelmet from "../../Shared/Helmet/SyncHelmet";
import SectionTittle from "../../Shared/SectionTittle/SectionTittle";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import CheckOutForm from "./CheckOutForm";
const stripePromise = loadStripe(import.meta.env.VITE_PK);

const Payment = () => {
  return (
    <div className="h-screen">
      <SyncHelmet loc={"Checkout"} />
      <SectionTittle title={"Checkout"} />
      <div className="px-36 md:px-14 lg:px-52  flex flex-col items-center justify-center ">
        <Elements stripe={stripePromise}>
          <CheckOutForm />
        </Elements>
      </div>
    </div>
  );

};

export default Payment;
