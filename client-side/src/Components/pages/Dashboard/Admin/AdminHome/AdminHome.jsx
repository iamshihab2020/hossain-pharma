import SyncHelmet from "../../../Shared/Helmet/SyncHelmet";
import Dash_Navbar from "../../../../layout/Dashboard/Dash_Navbar/Dash_Navbar";
import { useQuery } from "@tanstack/react-query";
import useAxiosSecure from "../../../../hooks/useAxiosSecure";
import {
  Card,
  CardBody,
  Typography,
} from "@material-tailwind/react";

const AdminHome = () => {
  const axiosSecure = useAxiosSecure();

  const { data: stats = {} } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const res = await axiosSecure.get("/admin-stats");
      return res.data;
    },
  });

  return (
    <>
      <SyncHelmet loc={"Admin Home"} />
      <Dash_Navbar title={"Admin Home"} />
      <div>
        <div className="flex items-center justify-start flex-wrap gap-5">
          {/* revenue */}
          <Card className="mt-6 w-64 flex flex-col items-center justify-center bg-[#1F2B5B] text-[#3DBDEC]">
            <CardBody>
              <Typography variant="lead">Total Revenue</Typography>
              <Typography
                variant="h2"
                color="blue-gray"
                className="mb-2 text-[#3DBDEC] text-center"
              >
                {stats.revenue} $
              </Typography>
            </CardBody>
          </Card>

          {/* Payment Pain */}
          <Card className="mt-6 w-64 flex flex-col items-center justify-center bg-[#1F2B5B] text-[#3DBDEC]">
            <CardBody>
              <Typography variant="lead">Payment Paid Total</Typography>
              <Typography
                variant="h2"
                color="blue-gray"
                className="mb-2 text-[#3DBDEC] text-center"
              >
                {stats.statusCounts && stats.statusCounts.accepted}
              </Typography>
            </CardBody>
          </Card>

          {/* Payment Pending */}
          <Card className="mt-6 w-64 flex flex-col items-center justify-center bg-[#1F2B5B] text-[#3DBDEC]">
            <CardBody>
              <Typography variant="lead">Payment Pending Total</Typography>
              <Typography
                variant="h2"
                color="blue-gray"
                className="mb-2 text-[#3DBDEC] text-center"
              >
                {stats.statusCounts && stats.statusCounts.pending}
              </Typography>
            </CardBody>
          </Card>

          {/* order */}
          <Card className="mt-6 w-64 flex flex-col items-center justify-center bg-[#1F2B5B] text-[#3DBDEC]">
            <CardBody>
              <Typography variant="lead">Total Orders</Typography>
              <Typography
                variant="h2"
                color="blue-gray"
                className="mb-2 text-[#3DBDEC] text-center"
              >
                {stats.orders}
              </Typography>
            </CardBody>
          </Card>

          {/* Customers */}
          <Card className="mt-6 w-64 flex flex-col items-center justify-center bg-[#1F2B5B] text-[#3DBDEC]">
            <CardBody>
              <Typography variant="lead">Total Customers</Typography>
              <Typography
                variant="h2"
                color="blue-gray"
                className="mb-2 text-[#3DBDEC] text-center"
              >
                {stats.roleCounts && stats.roleCounts.user}
              </Typography>
            </CardBody>
          </Card>

          {/* Customers */}
          <Card className="mt-6 w-64 flex flex-col items-center justify-center bg-[#1F2B5B] text-[#3DBDEC]">
            <CardBody>
              <Typography variant="lead">Total Sellers</Typography>
              <Typography
                variant="h2"
                color="blue-gray"
                className="mb-2 text-[#3DBDEC] text-center"
              >
                {stats.roleCounts && stats.roleCounts.seller}
              </Typography>
            </CardBody>
          </Card>

          {/* products  */}
          <Card className="mt-6 w-64 flex flex-col items-center justify-center bg-[#1F2B5B] text-[#3DBDEC]">
            <CardBody>
              <Typography variant="lead">Total Products</Typography>
              <Typography
                variant="h2"
                color="blue-gray"
                className="mb-2 text-[#3DBDEC] text-center"
              >
                {stats.productsItem}
              </Typography>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
};

export default AdminHome;
