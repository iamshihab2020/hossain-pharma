import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { useNavigate } from "react-router-dom";
import useAxiosSecure from "../../../hooks/useAxiosSecure";
import useCart from "../../../hooks/useCart";
import useAuth from "../../../hooks/useAuth";
import { Card, Button, Typography, Input } from "@material-tailwind/react";
// import { Input } from "postcss";

const CheckoutForm = () => {
  const [error, setError] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const stripe = useStripe();
  const elements = useElements();
  const axiosSecure = useAxiosSecure();
  const { user } = useAuth();
  const [cart, refetch] = useCart();
  const navigate = useNavigate();

  const totalPrice = cart.reduce(
    (total, item) => total + item.pricePerPack * item.quantity,
    0
  );

  useEffect(() => {
    if (totalPrice > 0) {
      axiosSecure
        .post("/create-payment-intent", { price: totalPrice })
        .then((res) => {
          console.log(res.data.clientSecret);
          setClientSecret(res.data.clientSecret);
        });
    }
  }, [axiosSecure, totalPrice]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const address = event.target.address.value;

    if (!stripe || !elements) {
      return;
    }

    const card = elements.getElement(CardElement);

    if (card === null) {
      return;
    }

    const { error, paymentMethod } = await stripe.createPaymentMethod({
      type: "card",
      card,
    });

    if (error) {
      console.log("payment error", error);
      setError(error.message);
    } else {
      console.log("payment method", paymentMethod);
      setError("");
    }

    // confirm payment
    const { paymentIntent, error: confirmError } =
      await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: card,
          billing_details: {
            email: user?.email || "anonymous",
            name: user?.displayName || "anonymous",
          },
        },
      });

    if (confirmError) {
      console.log("confirm error");
    } else {
      console.log("payment intent", paymentIntent);
      if (paymentIntent.status === "succeeded") {
        console.log("transaction id", paymentIntent.id);
        setTransactionId(paymentIntent.id);

        // now save the payment in the database
        const payment = {
          email: user.email,
          price: totalPrice,
          transactionId: paymentIntent.id,
          date: new Date(),
          address: address,
          cartIds: cart.map((item) => item._id),
          cartItems: cart.map((item) => ({
            productId: item.id,
            quantity: item.quantity,
            sellerEmail: item.sellerEmail
          })),
          productsIds: cart.map((item) => item.id),
          status: "pending",
        };

        const res = await axiosSecure.post("/payments", payment);
        console.log("payment saved", res.data);
        refetch();
        if (res.data?.paymentResult?.insertedId) {
          Swal.fire({
            position: "top-end",
            icon: "success",
            title: "Your payment successfully done. Thank you",
            showConfirmButton: false,
            timer: 2500,
          });
          navigate("/");
        }
      }
    }
  };

  return (
    <Card
      color="transparent"
      shadow={true}
      className="p-5 lg:p-10 border-2 border-[#3DBDEC]"
    >
      <Typography variant="h4" color="blue-gray" className="text-center">
        Pay with Card
      </Typography>
      <form
        onSubmit={handleSubmit}
        className="mt-8 mb-2 w-80 max-w-screen-lg sm:w-96"
      >
        <div className="mb-1 flex flex-col gap-6">
          <Typography variant="h6" color="blue-gray" className="-mb-3">
            Your Card Details
          </Typography>
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: "16px",
                  color: "#424770",
                  "::placeholder": {
                    color: "#aab7c4",
                  },
                },
                invalid: {
                  color: "#9e2146",
                },
              },
            }}
            className="border-2 border-blue-gray-100 p-3 rounded-md mb-8"
          />
        </div>
        <Typography variant="h6" color="blue-gray" className="mb-3">
          Your Address
        </Typography>

        <Input size="md" placeholder="Address" name="address" />

        <div className="flex items-center justify-center mt-5">
          <Button
            className="bg-[#3DBDEC]"
            type="submit"
            disabled={!stripe || !clientSecret}
          >
            Pay
          </Button>
        </div>
        <Typography className="text-red-500 text-center mt-3">
          {error}
          {transactionId && (
            <Typography className="text-green-600 text-center mt-3">
              Your transaction ID: {transactionId}
            </Typography>
          )}
        </Typography>
      </form>
    </Card>
  );
};

export default CheckoutForm;
