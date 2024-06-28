import { useLoaderData } from "react-router-dom";
import SectionTittle from "../../../../Shared/SectionTittle/SectionTittle";
import useProduct from "../../../../../hooks/useProduct";
import {
  Card,
  CardHeader,
  Input,
  Typography,
  Button,
  CardBody,
  CardFooter,
} from "@material-tailwind/react";
import { useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import CategoryBasedTable from "../CategoryBasedTable/CategoryBasedTable";

const TABLE_HEAD = [
  "Product Name",
  "Made By",
  "Per Unit Price",
  "Details",
  "Add to Cart",
];

const CategoryBased = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 7;
  const { categoryTag, categoryName } = useLoaderData();
  const [products, loading, error] = useProduct(categoryTag);
  const totalPages = Math.ceil(products.length / itemsPerPage);

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

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error.message}</div>;
  }

  return (
    <div>
      <div className="min-h-screen">
        <div className="-mt-10">
          <SectionTittle title={`${categoryName} Products`} />
        </div>
        <div className="px-10 lg:px-20 pb-14">
          <Card className="h-full w-full border-2 border-[#3DBDEC]">
            <CardHeader floated={false} shadow={false} className="rounded-none">
              <div className="flex flex-col items-center justify-between gap-4 md:flex-row p-5 border-2 border-[#3DBDEC] rounded-xl">
                <div className="w-full md:w-72">
                  <Input
                    label="Search"
                    icon={<MagnifyingGlassIcon className="h-5 w-5" />}
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
                <CategoryBasedTable
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
    </div>
  );
};

export default CategoryBased;
