import PropTypes from "prop-types";
import Swal from "sweetalert2";
import { Typography, Chip, Button } from "@material-tailwind/react";
import useAxiosSecure from "../../../../hooks/useAxiosSecure";

const PaymentTable = ({
  payments,
  currentPage,
  itemsPerPage,
  refetch,
}) => {
  const startIdx = (currentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const paginatedPayments = payments.slice(startIdx, endIdx);
  const axiosSecure = useAxiosSecure();

  const handleStatusChange = (payment, status) => {
    Swal.fire({
      title: "Are you sure?",
      text: `You are about to change this payment to ${status}.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: "Yes, do it!",
    }).then((result) => {
      if (result.isConfirmed) {
        axiosSecure
          .patch(`/payments/${status}/${payment._id}`)
          .then((res) => {
            if (res.data.modifiedCount > 0) {
              refetch();
              Swal.fire({
                title: "Success!",
                text: `This payment has been ${status}ed.`,
                icon: "success",
                confirmButtonColor: "#3085d6",
              });
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
            Swal.fire({
              title: "Error!",
              text: `Failed to update status: ${error.message}`,
              icon: "error",
              confirmButtonColor: "#3085d6",
            });
            console.error("Error updating status:", error);
          });
      }
    });
  };

  const renderStatusChip = (status) => {
    const statusColor =
      {
        pending: "orange",
        accepted: "green",
      }[status] || "green";

    return (
      <Chip
        value={status}
        size="sm"
        color={statusColor}
        className="rounded-full text-center"
      />
    );
  };

  const renderActionButton = (payment) => (
    <div className="flex gap-2">
      {payment.status === "pending" && (
        <Button
          onClick={() => handleStatusChange(payment, "accept")}
          size="sm"
          className="bg-green-500 rounded-full"
        >
          Accept
        </Button>
      )}
    </div>
  );




  return (
    <tbody>
      {paginatedPayments.map((payment, index) => {
        const isLast = index === paginatedPayments.length - 1;
        const classes = isLast ? "p-4" : "p-4 border-b border-[#3DBDEC]";
        return (
          <tr key={index}>
            <td className={classes}>
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <Typography
                    variant="small"
                    color="blue-gray"
                    className="font-bold opacity-70"
                  >
                    {index + 1}
                  </Typography>
                </div>
              </div>
            </td>

            <td className={classes}>
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <Typography variant="small" color="blue-gray">
                    {payment._id}
                  </Typography>
                </div>
              </div>
            </td>

            <td className={classes}>
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <Typography variant="small" color="blue-gray">
                    {payment.email}
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
                  {payment.transactionId}
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
                  {payment.price} $
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
                  <div className="w-20">{renderStatusChip(payment.status)}</div>
                </Typography>
              </div>
            </td>

            <td className={classes}>
              <div className="flex flex-col">{renderActionButton(payment)}</div>
            </td>
          </tr>
        );
      })}
    </tbody>
  );
};

PaymentTable.propTypes = {
  payments: PropTypes.array.isRequired,
  currentPage: PropTypes.number.isRequired,
  itemsPerPage: PropTypes.number.isRequired,
  refetch: PropTypes.func.isRequired,
  products: PropTypes.array.isRequired,
};

export default PaymentTable;
