import { useForm } from "react-hook-form";
import {
  Button,
  Dialog,
  DialogBody,
  IconButton,
  Input,
  Typography,
} from "@material-tailwind/react";
import PropTypes from "prop-types";
import Swal from "sweetalert2";
import useAxiosPublic from "../../../../hooks/useAxiosPublic";
import useAxiosSecure from "../../../../hooks/useAxiosSecure";

const image_hosting_key = import.meta.env.VITE_IMAGE_HOSTING_KEY;
const image_hosting_api = `https://api.imgbb.com/1/upload?key=${image_hosting_key}`;

const Add_Category = ({ open, onClose, addCategory, refetch }) => {
  const axiosPublic = useAxiosPublic();
  const axiosSecure = useAxiosSecure();
  const { register, handleSubmit, reset } = useForm();

  const onSubmit = async (data) => {
    try {
      const imageFile = { image: data.categoryImage[0] };
      const res = await axiosPublic.post(image_hosting_api, imageFile, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      if (res.data.success) {
        const categoryItems = {
          categoryName: data.categoryName,
          categoryImage: res.data.data.display_url,
          categoryTag: data.categoryName.replace(/\s+/g, ""),
        };

        const productsRes = await axiosSecure.post("/category", categoryItems);

        if (productsRes.data.insertedId) {
          refetch();
          onClose();
          Swal.fire({
            position: "top-end",
            icon: "success",
            title: `${data.categoryName} is added to the website.`,
            showConfirmButton: false,
            timer: 1500,
          }).then(() => {
            reset();
            addCategory(categoryItems);
          });
        }
      }
    } catch (error) {
      console.error("Error adding category:", error);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Failed to add category. Please try again later.",
      });
    }
  };

  return (
    <Dialog size="sm" open={open} handler={onClose}>
      <div className="flex items-center justify-center">
        <IconButton
          color="red"
          size="sm"
          variant="text"
          onClick={onClose}
          className="p-2 border-2 border-red-500 rounded-full absolute top-0 right-0 m-4"
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
      <DialogBody className="flex flex-col items-center justify-center gap-y-2 p-4">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col items-start justify-center gap-5"
        >
          <div>
            <Typography variant="h6" className="text-[#1F2B5B] mb-2">
              Category Name
            </Typography>
            <Input
              required
              className="max-w-full text-[#1F2B5B]"
              type="text"
              placeholder="Category Name"
              {...register("categoryName", { required: true })}
            />
          </div>
          <div>
            <Typography variant="h6" className="text-[#1F2B5B] mb-2">
              Category Image
            </Typography>
            <input
              required
              className="max-w-full text-[#1F2B5B]"
              type="file"
              {...register("categoryImage", { required: true })}
            />
          </div>

          <Button className="mt-6 bg-[#3DBDEC]" fullWidth type="submit">
            Add Category
          </Button>
        </form>
      </DialogBody>
    </Dialog>
  );
};

Add_Category.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  addCategory: PropTypes.func.isRequired,
  refetch: PropTypes.func.isRequired,
};

export default Add_Category;
