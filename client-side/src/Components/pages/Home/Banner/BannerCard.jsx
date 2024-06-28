import {
  Card,
  CardHeader,
  CardBody,
  Typography,
} from "@material-tailwind/react";
import PropTypes from "prop-types";

const BannerCard = ({ product }) => {
  const { image, itemName, pricePerPack, company } = product;
  return (
    <Card className="max-w-[24rem] h-[450px] overflow-hidden">
      <CardHeader
        floated={false}
        shadow={false}
        color="transparent"
        className="m-0 rounded-none"
      >
        <img
          src={image}
          alt={itemName}
          className="min-h-[350px]  object-fill "
        />
      </CardHeader>
      <CardBody className="text-left">
        <Typography variant="h4" color="blue-gray">
          {itemName}
        </Typography>
        <div className="flex items-center justify-between">
          <div>
            <Typography className="font-medium ">
              Price: ${pricePerPack}
            </Typography>
          </div>
        </div>
        <Typography color="blue-gray">{company}</Typography>
      </CardBody>
    </Card>
  );
};

BannerCard.propTypes = {
  product: PropTypes.object,
};
export default BannerCard;
