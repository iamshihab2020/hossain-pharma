import  {useState, useRef } from "react";
import { useDownloadExcel } from "react-export-table-to-excel";
import "jspdf-autotable";
import {
  Card,
  CardHeader,
  Input,
  Typography,
  Button,
  CardBody,
  CardFooter,
} from "@material-tailwind/react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { DateRange } from "react-date-range";

import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";
import usePayments from "../../../../hooks/usePayments";
import useProduct from "../../../../hooks/useProduct";
import SalesTable from "./SalesTable";

const TABLE_HEAD = [
  "",
  "Order ID",
  "Buyer Email",
  "Seller Email",
  "Products",
  "Transaction ID",
  "Total Price",
];

const ManageSales = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;
  const [searchQuery, setSearchQuery] = useState("");
  const [payments, refetch] = usePayments();
  const [products] = useProduct();
  const [dateRange, setDateRange] = useState([
    {
      startDate: null,
      endDate: null,
      key: "selection",
    },
  ]);
  const tableRef = useRef(null);

  const { onDownload: downloadExcel } = useDownloadExcel({
    currentTableRef: tableRef.current,
    filename: "Sales Report",
    sheet: "Sales",
  });

  const filteredProducts = payments.filter((payment) => {
    const transactionId = payment.transactionId
      ? payment.transactionId.toLowerCase()
      : "";
    const paymentDate = new Date(payment.createdAt);

    const isDateInRange =
      dateRange[0].startDate && dateRange[0].endDate
        ? paymentDate >= dateRange[0].startDate &&
          paymentDate <= dateRange[0].endDate
        : true;

    return transactionId.includes(searchQuery.toLowerCase()) && isDateInRange;
  });

  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

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
                  <Button onClick={downloadExcel} className="bg-[#3DBDEC] mt-10">
                    Download Report
                  </Button>
                </div>
                <div className="flex flex-col">
                  <DateRange
                    editableDateInputs={true}
                    onChange={(item) => setDateRange([item.selection])}
                    moveRangeOnFirstSelection={false}
                    ranges={dateRange}
                  />
                  <Button size="sm" className="bg-[#3DBDEC]" onClick={refetch}>
                    Apply Filter
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardBody className="overflow-scroll px-0">
              <table
                ref={tableRef}
                className="w-full min-w-max table-auto text-left"
              >
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
                <SalesTable
                  payments={filteredProducts}
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

export default ManageSales;
