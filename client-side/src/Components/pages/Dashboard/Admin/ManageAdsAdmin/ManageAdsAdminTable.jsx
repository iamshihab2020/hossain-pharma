import PropTypes from "prop-types";
import Swal from "sweetalert2";
import {
  Typography,
  Avatar,
  IconButton,
  Tooltip,
  Chip,
  Button,
} from "@material-tailwind/react";
import useAxiosSecure from "../../../../hooks/useAxiosSecure";

const ManageAdsAdminTable = ({
  adsProducts,
  currentPage,
  itemsPerPage,
  refetch,
}) => {
  const startIdx = (currentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const paginatedProducts = adsProducts.slice(startIdx, endIdx);
  const axiosSecure = useAxiosSecure();

  const handleStatusChange = (adsProduct, status) => {
    Swal.fire({
      title: "Are you sure?",
      text: `You are about to change this product's status to ${status}.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: "Yes, do it!",
    }).then((result) => {
      if (result.isConfirmed) {
        axiosSecure
          .patch(`/seller/ads/${status}/${adsProduct._id}`)
          .then((res) => {
            if (res.data.modifiedCount > 0) {
              if (status === "accept") {
                axiosSecure
                  .post("/seller/ads/approve", adsProduct)
                  .then(() => {
                    refetch();
                    Swal.fire({
                      title: "Success!",
                      text: `This ad has been ${status}ed.`,
                      icon: "success",
                      confirmButtonColor: "#3085d6",
                    });
                  })
                  .catch((error) => {
                    console.error("Error approving ad:", error);
                  });
              } else {
                refetch();
                Swal.fire({
                  title: "Success!",
                  text: `This ad has been ${status}ed.`,
                  icon: "success",
                  confirmButtonColor: "#3085d6",
                });
              }
            } else {
              Swal.fire({
                title: "No Changes!",
                text: `The status is already ${status}.`,
                icon: "info",
                confirmButtonColor: "#3085d6",
              });
            }
          })
          .catch((error) => {
            console.error("Error updating status:", error);
          });
      }
    });
  };

  const handleDeleteAds = (adsProducts) => {
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
        axiosSecure.delete(`/approvedAds/${adsProducts._id}`).then((res) => {
          if (res.data.deletedCount > 0) {
            refetch();
            Swal.fire({
              title: "Deleted!",
              text: "Your product has been deleted from website.",
              icon: "success",
              confirmButtonColor: "#3085d6",
            });
          }
        });
      }
    });
  };

  return (
    <>
      <tbody>
        {paginatedProducts.map((adsProducts, index) => {
          const isLast = index === paginatedProducts.length - 1;
          const classes = isLast ? "p-4" : "p-4 border-b border-[#3DBDEC]";
          return (
            <tr key={index}>
              <td className={classes}>
                <div className="flex items-center gap-3">
                  <Avatar src={adsProducts.image} size="sm" />
                  <div className="flex flex-col">
                    <Typography
                      variant="small"
                      color="blue-gray"
                      className="font-bold opacity-70"
                    >
                      {adsProducts.itemName}
                    </Typography>
                  </div>
                </div>
              </td>

              <td className={classes}>
                <div className="flex flex-col">
                  <Typography
                    variant="small"
                    color="blue-gray"
                    className="font-normal"
                  >
                    {adsProducts.company}
                  </Typography>
                </div>
              </td>

              <td className={classes}>
                <div className="flex flex-col">
                  <Typography
                    variant="small"
                    color="blue-gray"
                    className="font-normal"
                  >
                    $ {adsProducts.pricePerPack}
                  </Typography>
                </div>
              </td>

              <td className={classes}>
                <div className="flex flex-col w-52">
                  <Typography
                    variant="small"
                    color="blue-gray"
                    className="font-normal"
                  >
                    {adsProducts.shortDescription}
                  </Typography>
                </div>
              </td>

              <td className={classes}>
                <div className="flex flex-col">
                  <Typography
                    variant="small"
                    color="blue-gray"
                    className="font-normal"
                  >
                    <div className="w-20">
                      {adsProducts.adsStatus === "rejected" ? (
                        <Chip
                          value={adsProducts.adsStatus}
                          size="sm"
                          color="red"
                          className="rounded-full text-center"
                        />
                      ) : adsProducts.adsStatus === "pending" ? (
                        <Chip
                          value={adsProducts.adsStatus}
                          size="sm"
                          color="orange"
                          className="rounded-full text-center"
                        />
                      ) : adsProducts.adsStatus === "accepted" ||
                        !adsProducts.adsStatus ? (
                        <Chip
                          value={adsProducts.adsStatus || "accepted"}
                          size="sm"
                          color="green"
                          className="rounded-full text-center"
                        />
                      ) : null}
                    </div>
                  </Typography>
                </div>
              </td>

              <td className={classes}>
                <div className="flex flex-col">
                  <div className="flex gap-2">
                    {adsProducts.adsStatus === "pending" && (
                      <Button
                        onClick={() =>
                          handleStatusChange(adsProducts, "accept")
                        }
                        size="sm"
                        className="bg-green-500 rounded-full"
                      >
                        Accept
                      </Button>
                    )}
                    {adsProducts.adsStatus !== "rejected" && (
                      <Button
                        onClick={() =>
                          handleStatusChange(adsProducts, "reject")
                        }
                        size="sm"
                        className="bg-red-500 rounded-full"
                      >
                        Reject
                      </Button>
                    )}
                  </div>
                </div>
              </td>


              <td className={classes}>
                <div className="flex item-start justify-start">
                  <Tooltip content="Delete this ads">
                    <IconButton
                      onClick={() => handleDeleteAds(adsProducts)}
                      className="bg-transparent text-red-500 shadow-none rounded-full border-2 border-red-500"
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
                          d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                        />
                      </svg>
                    </IconButton>
                  </Tooltip>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </>
  );
};

ManageAdsAdminTable.propTypes = {
  adsProducts: PropTypes.array.isRequired,
  currentPage: PropTypes.number.isRequired,
  itemsPerPage: PropTypes.number.isRequired,
  refetch: PropTypes.func.isRequired,
};

export default ManageAdsAdminTable;
