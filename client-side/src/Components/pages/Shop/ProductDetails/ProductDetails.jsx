import {
  Dialog,
  DialogHeader,
  DialogBody,
  IconButton,
  Typography,
} from "@material-tailwind/react";
import PropTypes from "prop-types";

const ProductDetails = ({ product, open, onClose }) => {
  if (!product) return null;
  const {
    image,
    itemName,
    itemGenericName,
    itemMassUnit,
    shortDescription,
    storeName,
    company,
    perUnitPrice,
    pricePerPack,
  } = product;

  return (
    <Dialog className="p-4  mt-10" size="lg" open={open} handler={onClose}>
      <div className="flex items-center justify-center  ">
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

      <div className="lg:py-10 lg:px-10 w-full flex items-start justify-center flex-col md:flex-row">
        <DialogHeader className="justify-start">
          <img src={image} alt={itemName} className="w-64 h-64" />
        </DialogHeader>
        <DialogBody className="overflow-x-scroll overflow-y-scroll  flex flex-col gap-y-2">
          <Typography
            variant="h4"
            color="blue-gray"
            className="mb-1 font-bold text-[#3DBDEC]"
          >
            {itemName}
          </Typography>

          <Typography variant="paragraph" className="font-normal text-gray-600">
            <span className="font-bold">Generic Name: </span>
            {itemGenericName}
          </Typography>

          <Typography variant="paragraph" className="font-normal text-gray-600">
            <span className="font-bold">Made by: </span>
            {company}
          </Typography>

          <Typography variant="paragraph" className="font-normal text-gray-600">
            <span className="font-bold">Price Per Unit: </span>
            {perUnitPrice} $
          </Typography>

          <Typography variant="paragraph" className="font-normal text-gray-600">
            <span className="font-bold">Price Per Pack: </span>
            {pricePerPack} $
          </Typography>

          <Typography variant="paragraph" className="font-normal text-gray-600">
            <span className="font-bold">Mass Unit: </span>
            {itemMassUnit}
          </Typography>

          <Typography variant="paragraph" className="font-normal text-gray-600">
            <span className="font-bold">Description: </span>
            {shortDescription}
          </Typography>

          <div className="flex items-end justify-end">
            <Typography
              variant="paragraph"
              className="font-normal text-red-500"
            >
              <span className="font-bold">Store: </span>
              {storeName}
            </Typography>
          </div>
        </DialogBody>
      </div>
    </Dialog>
  );
};

ProductDetails.propTypes = {
  product: PropTypes.object.isRequired,
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default ProductDetails;
