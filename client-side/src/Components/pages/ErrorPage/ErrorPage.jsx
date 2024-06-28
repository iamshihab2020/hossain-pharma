import Lottie from "lottie-react";
import sadAnimation from "../../../assets/lottie/error.json";
import { Typography } from "@material-tailwind/react";
import { Link } from "react-router-dom";
import { Button } from "@material-tailwind/react";

const ErrorPage = () => {
  return (
    <div className="flex items-center justify-center flex-col py-32 px-8 md:px-12 lg:px-20">
      <Typography variant="h1" className="text-center lg:text-6xl text-red-700 pb-0 lg:pb-14">
        404 Error Page No Found
      </Typography>
      <Lottie animationData={sadAnimation} style={{ height: 450 }} />
      <Link to={`/`}>
        <Button className="bg-red-700 ">Back To Home</Button>
      </Link>
    </div>
  );
};

export default ErrorPage;
