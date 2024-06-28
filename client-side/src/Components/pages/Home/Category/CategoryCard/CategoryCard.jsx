import {
  Card,
  CardBody,
  CardFooter,
  Typography,
  Button,
} from "@material-tailwind/react";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";

const CategoryCard = ({ item }) => {
  const { categoryName, categoryImage, categoryTag } = item;

  return (
    <Card className="mt-6 w-96 flex items-center justify-center border-2 border-[#3DBDEC]">
      <CardBody className="flex flex-col items-center justify-center">
        <img src={categoryImage} alt={categoryName} className="h-36" />
        <Typography variant="h2" color="blue-gray" className="mb-2 mt-5">
          {categoryName}
        </Typography>
      </CardBody>
      <CardFooter className="pt-0">
        <Link to={`/category/${categoryTag}`} className="inline-block">
          <Button size="sm" className="flex items-center gap-2 bg-[#3DBDEC]">
            See More
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="h-4 w-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3"
              />
            </svg>
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
};

CategoryCard.propTypes = {
  item: PropTypes.object.isRequired,
};

export default CategoryCard;
