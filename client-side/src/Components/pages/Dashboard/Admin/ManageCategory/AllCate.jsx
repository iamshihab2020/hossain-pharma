import {
  IconButton,
  Card,
  List,
  ListItem,
  Typography,
  Dialog,
  DialogBody,
} from "@material-tailwind/react";
import PropTypes from "prop-types";
import Swal from "sweetalert2";
import useAxiosSecure from "../../../../hooks/useAxiosSecure";

const AllCate = ({ allCate, open, onClose, refetch }) => {
  const axiosSecure = useAxiosSecure();

  if (!allCate) return null;

  const deleteCategory = async (id) => {
    try {
      const response = await axiosSecure.delete(`/category/${id}`);
      if (response.status === 200) {
        refetch()
        onClose();
        Swal.fire({
          icon: "success",
          title: "Category Deleted",
          text: "The category has been deleted successfully.",
        })
      } else {
        throw new Error("Failed to delete category");
      }
    } catch (error) {
      console.error("Error deleting category:", error);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Failed to delete category. Please try again later.",
      });
    }
  };

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
      <DialogBody className="flex flex-col items-center justify-center gap-y-2">
        <Typography variant="h4" className="text-center text-[#3DBDEC]">
          All Categories
        </Typography>
        {allCate.map((cate) => (
          <Card className="w-96" key={cate._id}>
            <List>
              <ListItem className=" flex items-center justify-between ">
                {cate.categoryName}
                <IconButton
                  className="bg-red-500"
                  onClick={() => deleteCategory(cate._id)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="size-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                    />
                  </svg>
                </IconButton>
              </ListItem>
            </List>
          </Card>
        ))}
      </DialogBody>
    </Dialog>
  );
};

AllCate.propTypes = {
  allCate: PropTypes.array.isRequired,
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  refetch: PropTypes.func.isRequired,
};

export default AllCate;
