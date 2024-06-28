import Dash_Navbar from "../../../../layout/Dashboard/Dash_Navbar/Dash_Navbar";
import SyncHelmet from "../../../Shared/Helmet/SyncHelmet";
import { useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import {
  Card,
  CardHeader,
  Input,
  Typography,
  Button,
  CardBody,
  CardFooter,
} from "@material-tailwind/react";
import usePayments from "../../../../hooks/usePayments";
import useProduct from "../../../../hooks/useProduct";
import SellerPaymentTable from "./SellerPaymentTable";
import useAuth from "../../../../hooks/useAuth";

const TABLE_HEAD = [
  "",
  "Order ID",
  "Buyer Email",
  "Seller Email",
  "Product Name",
  "Transaction ID",
  "Price",
  "Status",
];

const SellerManagePayments = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;
  const [searchQuery, setSearchQuery] = useState("");
  const [payments, refetch] = usePayments();
  const [products] = useProduct();
  const { user } = useAuth();

  const sellerPayments = payments.filter(
    (payment) =>
      payment.cartItems &&
      payment.cartItems.some((item) => {
        const product = products.find((p) => p._id === item.productId);
        return product && product.sellerEmail === user.email;
      })
  );

  const filteredPayments = sellerPayments.filter((payment) => {
    const transactionId = payment.transactionId
      ? payment.transactionId.toLowerCase()
      : "";
    return transactionId.includes(searchQuery.toLowerCase());
  });

  const totalPages = Math.ceil(filteredPayments.length / itemsPerPage);

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage((prevPage) => prevPage + 1);
    }
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage((prevPage) => Math.max(prevPage - 1, 1));
    }
  };

  return (
    <div>
      <SyncHelmet loc={"Manage Payment"} />
      <Dash_Navbar title={"Manage Payment"}/>
      <div>
        <div className="pb-14">
          <Card className="h-full w-full border-2 border-[#3DBDEC]">
            <CardHeader floated={false} shadow={false} className="rounded-none">
              <div className="flex items-start flex-col gap-4 md:flex-row p-5 border-2 border-[#3DBDEC] rounded-xl">
                <div className="w-full md:w-72">
                  <Input
                    label="Search"
                    icon={<MagnifyingGlassIcon className="h-5 w-5" />}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
            </CardHeader>

            <CardBody className="overflow-scroll px-0">
              <table className="w-full min-w-max table-auto text-left">
                <thead>
                  <tr>
                    {TABLE_HEAD.map((head) => (
                      <th
                        key={head}
                        className="border-y border-blue-gray-100 bg-[#3DBDEC] p-4 text-white"
                      >
                        <Typography
                          variant="small"
                          className="font-bold leading-none"
                        >
                          {head}
                        </Typography>
                      </th>
                    ))}
                  </tr>
                </thead>
                <SellerPaymentTable
                  payments={filteredPayments}
                  currentPage={currentPage}
                  itemsPerPage={itemsPerPage}
                  refetch={refetch}
                  products={products}
                />
              </table>
            </CardBody>
            <CardFooter className="flex items-center justify-between border-t border-blue-gray-50 p-4">
              <Typography
                variant="small"
                color="blue-gray"
                className="font-normal"
              >
                Page {currentPage} of {totalPages}
              </Typography>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="bg-[#3DBDEC]"
                  onClick={handlePreviousPage}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <Button
                  className="bg-[#3DBDEC]"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SellerManagePayments;
