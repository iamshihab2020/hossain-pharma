import { useQuery } from "@tanstack/react-query";
import useAuth from "../../../hooks/useAuth";
import useAxiosSecure from "../../../hooks/useAxiosSecure";
import { Card,Chip, Typography, } from "@material-tailwind/react";
import SyncHelmet from "../../Shared/Helmet/SyncHelmet";
import Dash_Navbar from "../../../layout/Dashboard/Dash_Navbar/Dash_Navbar";

const PaymentHistory = () => {
  const { user } = useAuth();
  const axiosSecure = useAxiosSecure();

  const { data: payments = [] } = useQuery({
    queryKey: ["payments", user.email],
    queryFn: async () => {
      const res = await axiosSecure.get(`/payments/${user.email}`);
      return res.data;
    },
  });

  return (
    <div className="px-14">
      <SyncHelmet loc={"Payment History"} />
      <Dash_Navbar title={"Payment History"} />
      <div className="pb-20">
        <Card className="h-full w-full overflow-scroll">
          <table className="w-full min-w-max table-auto text-left">
            <thead>
              <tr>
                {["", "Order ID", "Paid", "Transaction ID", "Status"].map(
                  (head) => (
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
                  )
                )}
              </tr>
            </thead>
            <tbody className="border-b-2 border-[#3DBDEC]">
              {payments.map((item, indx) => (
                <tr key={item._id} className="even:bg-[#3DBDEC]">
                  <td className="p-4">
                    <Typography
                      variant="small"
                      color="blue-gray"
                      className="font-normal"
                    >
                      {indx + 1}
                    </Typography>
                  </td>
                  <td className="p-4">
                    <Typography
                      variant="small"
                      color="blue-gray"
                      className="font-normal"
                    >
                      {item._id}
                    </Typography>
                  </td>
                  <td className="p-4">
                    <Typography
                      variant="small"
                      color="blue-gray"
                      className="font-normal"
                    >
                      $ {item.price}
                    </Typography>
                  </td>
                  <td className="p-4">
                    <Typography
                      variant="small"
                      color="blue-gray"
                      className="font-normal"
                    >
                      {item.transactionId}
                    </Typography>
                  </td>
                  <td className="pr-10 w-20">
                    <Typography
                      variant="small"
                      color="blue-gray"
                      className="font-normal"
                    >
                      {item.status === "rejected" ? (
                        <Chip
                          value={item.status}
                          size="sm"
                          color="red"
                          className="rounded-full text-center"
                        />
                      ) : item.status === "pending" ? (
                        <Chip
                          value={item.status}
                          size="sm"
                          color="orange"
                          className="rounded-full text-center"
                        />
                      ) : item.status === "accepted" || !item.status ? (
                        <Chip
                          value={item.status || "accepted"}
                          size="sm"
                          color="green"
                          className="rounded-full text-center"
                        />
                      ) : null}
                    </Typography>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
};

export default PaymentHistory;
