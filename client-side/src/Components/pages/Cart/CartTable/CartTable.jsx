/* eslint-disable no-unused-vars */
import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Typography, Tooltip } from "@material-tailwind/react";
import Swal from "sweetalert2";
import useAxiosSecure from "../../../hooks/useAxiosSecure";

const CartTable = ({ item, refetch }) => {
  const { itemName, company, perUnitPrice, pricePerPack, quantity, _id, sellerEmail } = item;
  const [qty, setQty] = useState(quantity || 1);
  const axiosSecure = useAxiosSecure();

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
        axiosSecure.delete(`/cart/${id}`).then((res) => {
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

  const handleIncreaseQuantity = async () => {
    const newQuantity = qty + 1;
    setQty(newQuantity);
    updateQuantity(newQuantity);
  };

  const handleDecreaseQuantity = async () => {
    if (qty > 1) {
      const newQuantity = qty - 1;
      setQty(newQuantity);
      updateQuantity(newQuantity);
    }
  };

  const updateQuantity = async (newQuantity) => {
    const updatedItem = { ...item, quantity: newQuantity };
    await axiosSecure.patch(`/cart/${_id}`, { quantity: newQuantity });
    refetch(); // Fetch updated cart after quantity update
  };


  return (
    <tr key={_id} className="even:bg-[#3DBDEC]">
      <td className="p-4">
        <Typography variant="small" color="blue-gray" className="font-normal">
          {itemName}
        </Typography>
      </td>
      <td className="p-4">
        <Typography variant="small" color="blue-gray" className="font-normal">
          {company}
        </Typography>
      </td>
      <td className="p-4">
        <Typography variant="small" color="blue-gray" className="font-normal">
          $ {perUnitPrice}
        </Typography>
      </td>
      <td className="p-4">
        <Typography variant="small" color="blue-gray" className="font-normal">
          $ {pricePerPack}
        </Typography>
      </td>
      <td className="p-4">
        <div className="flex items-center">
          <Button
            className="rounded-full px-3 py-0 text-lg bg-red-600"
            onClick={handleDecreaseQuantity}
          >
            -
          </Button>
          <span className="px-2">{qty}</span>
          <Button
            className="rounded-full px-2 py-0 text-lg bg-green-600"
            onClick={handleIncreaseQuantity}
          >
            +
          </Button>
        </div>
      </td>
      <td className="p-4">
        <Tooltip content="Delete this product">
          <Button
            onClick={() => handleDeleteProduct(_id)}
            size="sm"
            color="red"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="size-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
              />
            </svg>
          </Button>
        </Tooltip>
      </td>
    </tr>
  );
};

CartTable.propTypes = {
  item: PropTypes.object.isRequired,
  refetch: PropTypes.func.isRequired,
};

export default CartTable;
