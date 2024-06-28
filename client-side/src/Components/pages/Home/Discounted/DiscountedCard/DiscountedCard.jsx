import {
  Card,
  CardHeader,
  CardBody,
  Typography,
  IconButton,
  Tooltip,
} from "@material-tailwind/react";
import PropTypes from "prop-types"; // ES6
import useAuth from "../../../../hooks/useAuth";
import { useLocation, useNavigate } from "react-router-dom";
import useAxiosSecure from "../../../../hooks/useAxiosSecure";
import useCart from "../../../../hooks/useCart";
import Swal from "sweetalert2";

const DiscountedCard = ({ product }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const axiosSecure = useAxiosSecure();
  const [cart, refetch] = useCart();

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
        sellerEmail: product.sellerEmail,
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

  const { itemName, pricePerPack, discountPercentage } = product;
  const discountedResult =
    pricePerPack - (pricePerPack * discountPercentage) / 100;
  const discountedPrice = discountedResult.toFixed(2);

  return (
    <Card className="max-w-[24rem] h-[450px] overflow-hidden">
      <CardHeader
        floated={false}
        shadow={false}
        color="transparent"
        className="m-0 rounded-none"
      >
        <img
          src={product.image}
          alt={itemName}
          className="min-h-[350px]  object-fill "
        />
      </CardHeader>
      <CardBody className="text-left">
        <Typography variant="h4" color="blue-gray">
          {itemName}
        </Typography>
        <div className="flex items-center justify-between">
          <div>
            <Typography className="font-medium ">
              Price: ${pricePerPack}
            </Typography>
            {discountedPrice && (
              <Typography className="font-bold">
                Discounted Price:{" "}
                <span className="text-[#3DBDEC]">${discountedPrice}</span>
              </Typography>
            )}
          </div>
          <div>
            <Tooltip content="Add to cart">
              <IconButton
                variant="sm"
                onClick={() => handleAddToCart(product)}
                className="bg-[#3DBDEC]"
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
                    d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
                  />
                </svg>
              </IconButton>
            </Tooltip>
          </div>
        </div>
      </CardBody>
    </Card>
  );
};

DiscountedCard.propTypes = {
  product: PropTypes.object,
};

export default DiscountedCard;
