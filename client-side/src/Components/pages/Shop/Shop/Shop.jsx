import { useState } from "react";
import SyncHelmet from "../../Shared/Helmet/SyncHelmet";
import SectionTittle from "../../Shared/SectionTittle/SectionTittle";
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
import ShopTable from "../ShopTable/ShopTable";
import useProduct from "../../../hooks/useProduct";

const TABLE_HEAD = [
  "Product Name",
  "Made By",
  "Per Unit Price",
  "Price Per Pack",
  "Details",
  "Add to Cart",
];

const Shop = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 7;
  const [searchQuery, setSearchQuery] = useState("");
  const [products] = useProduct();

  // Filter products based on search query
  const filteredProducts = products.filter(
    (product) =>
      product.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.itemGenericName
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      product.company.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
    <>
      <SyncHelmet loc={"Shop"} />
      <div className="min-h-screen">
        <div className="-mt-10">
          <SectionTittle title={"Shop"} />
        </div>
        <div className="px-10 lg:px-20 pb-14">
          <Card className="h-full w-full border-2 border-[#3DBDEC]">
            <CardHeader floated={false} shadow={false} className="rounded-none">
              <div className="flex flex-col items-center justify-between gap-4 md:flex-row p-5 border-2 border-[#3DBDEC] rounded-xl">
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
              <table className="mt-4 w-full min-w-max table-auto text-left">
                <thead>
                  <tr>
                    {TABLE_HEAD.map((head) => (
                      <th
                        key={head}
                        className="border-y border-blue-gray-100 bg-[#3DBDEC] p-4 text-white"
                      >
                        <Typography
                          variant="small"
                          className="font-bold leading-none opacity-70"
                        >
                          {head}
                        </Typography>
                      </th>
                    ))}
                  </tr>
                </thead>
                <ShopTable
                  products={filteredProducts}
                  currentPage={currentPage}
                  itemsPerPage={itemsPerPage}
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
    </>
  );
};

export default Shop;
