import Lottie from "lottie-react";
import banAnimation from "../../../../assets/lottie/bann.json";
import { Typography, Button } from "@material-tailwind/react";
const Banner = () => {
  return (
    <div className="min-h-screen bg-gray-100 shadow-lg  flex items-center justify-between flex-col-reverse lg:flex-row px-5 animate__animated animate__fadeInUp">
      <div className="-mt-20 md:-mt-0 lg:w-1/2">
        <Lottie animationData={banAnimation} style={{ height: 600 }} />
      </div>
      <div className="flex flex-col lg:w-1/2 gap-y-5 mt-10 md:mt-10 lg:mt-10 ">
        <Typography
          variant="h3"
          className="text-[#3DBDEC] text-3xl md:text-5xl lg:text-6xl"
        >
          Welcome to <br /> Hossain Pharmaceuticals
        </Typography>
        <Typography variant="lead">
          Find, Get Know and Buy your desired medicine.
        </Typography>
        <div>
          <Button variant="lg" className="bg-[#3DBDEC]">
            Start Buying
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Banner;
