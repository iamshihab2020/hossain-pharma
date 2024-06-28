import { useContext } from "react";
import useCart from "../../../hooks/useCart";
import SectionTittle from "../../Shared/SectionTittle/SectionTittle";
import { Button, Card, Typography, Tooltip } from "@material-tailwind/react";
import CartTable from "../CartTable/CartTable";
import SyncHelmet from "../../Shared/Helmet/SyncHelmet";
import { AuthContext } from "../../../providers/AuthProvider";
import Swal from "sweetalert2";
import useAxiosSecure from "../../../hooks/useAxiosSecure";
import { Link } from "react-router-dom";

const Cart = () => {
  const [cart, refetch] = useCart();
  const axiosSecure = useAxiosSecure();
  const { user } = useContext(AuthContext);

  const totalPrice = cart.reduce(
    (total, item) => total + item.pricePerPack * item.quantity,
    0
  );

  const handleDeleteAll = (email) => {
    Swal.fire({
      title: "Are you sure you want to delete all?",
      text: "You won't be able to revert this!",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: "Yes, delete all!",
    }).then((result) => {
      if (result.isConfirmed) {
        axiosSecure.delete(`/cart/user/${email}`).then((res) => {
          if (res.data.deletedCount > 0) {
            refetch();
            Swal.fire({
              title: "Deleted!",
              text: "Your product has been deleted from cart.",
              icon: "success",
              confirmButtonColor: "#3085d6",
            });
          }
        });
      }
    });
  };

  return (
    <div className="-mt-14 px-14">
      <SyncHelmet loc={"Cart"} />
      <SectionTittle title={"My Cart"} />

      <div className="flex justify-between p-5 rounded-xl mb-10 bg-[#1F2B5B]">
        <Typography variant="lg" color="white" className="text-lg font-normal">
          Total Items: {cart.length}
        </Typography>
        <Typography variant="lg" color="white" className="text-lg font-normal">
          Total Price: $ {totalPrice}
        </Typography>
        {cart.length ? (
          <Link to={"/user/payment"}>
            <Button size="sm" className="bg-[#3DBDEC]">
              Checkout
            </Button>
          </Link>
        ) : (
          <Button size="sm" className="bg-[#3DBDEC]" disabled>
            Checkout
          </Button>
        )}
      </div>

      <div className="pb-20">
        <Card className="h-full w-full overflow-scroll">
          <table className="w-full min-w-max table-auto text-left">
            <thead>
              <tr>
                {[
                  "Name",
                  "Company",
                  "Unit Price",
                  "Price per Pack",
                  "Quantity",
                  "Action",
                ].map((head) => (
                  <th
                    key={head}
                    className="border-b border-blue-gray-100 bg-[#3DBDEC] p-4"
                  >
                    <Typography
                      variant="lg"
                      color="blue-gray"
                      className="font-bold text-white leading-none"
                    >
                      {head}
                    </Typography>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="border-b-2 border-[#3DBDEC]">
              {cart.map((item) => (
                <CartTable key={item._id} item={item} refetch={refetch} />
              ))}
            </tbody>
            <td className="p-4">
              <Typography
                variant="lg"
                color="blue-gray"
                className="font-medium"
              >
                Total Items: {cart.length}
              </Typography>
            </td>
            <td className="p-4"></td>
            <td className="p-4"></td>
            <td className="p-4">
              <Typography
                variant="lg"
                color="blue-gray"
                className="font-medium"
              >
                Total Price: $ {totalPrice}
              </Typography>
            </td>
            <td className="p-4">
              <Tooltip content="Remove all product">
                <Button
                  variant="small"
                  color="red"
                  className="font-medium"
                  onClick={() => handleDeleteAll(user.email)}
                >
                  Clear
                </Button>
              </Tooltip>
            </td>
          </table>
        </Card>
      </div>
    </div>
  );
};

export default Cart;
