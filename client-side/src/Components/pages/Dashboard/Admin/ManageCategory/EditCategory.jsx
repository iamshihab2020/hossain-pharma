import {
  Dialog,
  DialogHeader,
  DialogBody,
  IconButton,
  Typography,
  Button,
} from "@material-tailwind/react";
import PropTypes from "prop-types";
import { useForm } from "react-hook-form";
import useCategory from "../../../../hooks/useCategory"; // Update the path as per your directory structure
import useAxiosSecure from "../../../../hooks/useAxiosSecure";
import Swal from "sweetalert2";

const EditCategory = ({ product, open, onClose }) => {
  const { categories, refetch } = useCategory();
  const { register, handleSubmit } = useForm({
    defaultValues: { category: product.category },
  });
  const axiosSecure = useAxiosSecure();

  const onSubmit = async (data) => {
    try {
      const response = await axiosSecure.put(
        `/products/${product._id}/category`,
        {
          category: data.category,
          categoryTag: data.category.replace(/\s+/g, ""),
        }
      );
      console.log("Category updated successfully:", response.data);
      refetch();
      Swal.fire({
        icon: "success",
        title: "Success",
        text: "Category updated successfully!",
      }).then(() => {
        window.location.reload();
      });
      onClose();
    } catch (error) {
      console.error("Error updating category:", error);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Failed to update category. Please try again.",
      });
    }
  };

  if (!product) return null;

  return (
    <Dialog className="p-4 mt-10" size="sm" open={open} handler={onClose}>
      <div className="flex items-center justify-center">
        <IconButton
          color="red"
          size="sm"
          variant="text"
          onClick={onClose}
          className="p-2 border-2 border-red-500 rounded-full"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            className="h-4 w-4"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </IconButton>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="lg:py-10 lg:px-10 w-full flex items-start justify-center flex-col md:flex-row"
      >
        <DialogHeader className="justify-start">
          <img
            src={product.image}
            alt={product.itemName}
            className="w-64 h-64"
          />
        </DialogHeader>
        <DialogBody className="flex flex-col gap-y-2">
          <Typography
            variant="h4"
            color="blue-gray"
            className="mb-1 font-bold text-[#3DBDEC]"
          >
            {product.itemName}
          </Typography>

          <div className="w-full">
            <select
              {...register("category")}
              className="w-full py-2 text-base border-gray-300 px-2 rounded-lg border-2 text-[#1F2B5B]"
            >
              <option>Select Category</option>
              {categories.map((category) => (
                <option key={category._id} value={category.categoryName}>
                  {category.categoryName}
                </option>
              ))}
            </select>
          </div>

          <Button type="submit" color="blue" className="mt-4">
            Update Category
          </Button>
        </DialogBody>
      </form>
    </Dialog>
  );
};

EditCategory.propTypes = {
  product: PropTypes.object.isRequired,
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default EditCategory;
