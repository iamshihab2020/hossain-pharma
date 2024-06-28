import SyncHelmet from "../../../Shared/Helmet/SyncHelmet";
import Dash_Navbar from "../../../../layout/Dashboard/Dash_Navbar/Dash_Navbar";
import useProduct from "../../../../hooks/useProduct";
import useCategory from "../../../../hooks/useCategory";
import ManageCategoryTable from "./ManageCategoryTable";
import AllCate from "./AllCate";
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
import Add_Category from "./Add_Category";


const TABLE_HEAD = [
  "Product Name",
  "Category",
  "Made By",
  "Price Per Pack",
  "Details",
  "Update Category",
];

const ManageCategory = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 7;
  const [searchQuery, setSearchQuery] = useState("");
  const [products] = useProduct();
  const { categories,refetch } = useCategory();
  const [allCate, setAllCate] = useState(null);
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);

  const handleAllCate = (categories) => {
    setAllCate(categories);
  };

  const filteredProducts = (products || []).filter(
    (product) =>
      (product.itemName &&
        product.itemName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (product.itemGenericName &&
        product.itemGenericName
          .toLowerCase()
          .includes(searchQuery.toLowerCase())) ||
      (product.company &&
        product.company.toLowerCase().includes(searchQuery.toLowerCase()))
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

  const openAddCategoryModal = () => {
    setIsAddCategoryModalOpen(true);
  };

  const closeAddCategoryModal = () => {
    setIsAddCategoryModalOpen(false);
  };
  return (
    <>
      <SyncHelmet loc={"Manage Category"} />
      <Dash_Navbar title={"Manage Category"} />

      <div>
        <div className="pb-14">
          <Card className="h-full w-full border-2 border-[#3DBDEC]">
            <CardHeader floated={false} shadow={false} className="rounded-none">
              <div className="flex flex-col items-center justify-start gap-4 md:flex-row p-5 border-2 border-[#3DBDEC] rounded-xl">
                <div className="w-full md:w-72">
                  <Input
                    label="Search"
                    icon={<MagnifyingGlassIcon className="h-5 w-5" />}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-x-5">
                  <Button
                    variant="lg"
                    className="bg-[#3DBDEC] capitalize"
                    onClick={() => handleAllCate(categories)}
                  >
                    See All Categories
                  </Button>
                  <Button
                    variant="lg"
                    className="bg-[#3DBDEC] capitalize"
                    onClick={openAddCategoryModal}
                  >
                    Add Category
                  </Button>
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
                <ManageCategoryTable
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
      {allCate && (
        <AllCate
          allCate={allCate}
          open={Boolean(allCate)}
          onClose={() => setAllCate(null)}
          refetch={refetch}
        />
      )}
      <Add_Category
        open={isAddCategoryModalOpen}
        onClose={closeAddCategoryModal}
        refetch={refetch}
      />
    </>
  );
};

export default ManageCategory;
