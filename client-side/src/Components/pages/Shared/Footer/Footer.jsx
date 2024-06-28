import { Typography } from "@material-tailwind/react";
import logo from "../../../../assets/logo.png";

const Footer = () => {
  return (
    <footer className="w-full bg-white p-8 border-[#3DBDEC] border-t-2">
      <div className="flex flex-row flex-wrap items-center justify-center gap-y-6 gap-x-12 bg-white text-center md:justify-between">
        <img src={logo} alt="logo-ct" className="w-40" />
        <ul className="flex flex-wrap items-center gap-y-2 gap-x-8">
          <li>
            <Typography
              as="a"
              href="#"
              color="blue-gray"
              className="font-normal transition-colors hover:text-[#3DBDEC] focus:text-[#3DBDEC]"
            >
              Pages
            </Typography>
          </li>
          <li>
            <Typography
              as="a"
              href="#"
              color="blue-gray"
              className="font-normal transition-colors hover:text-[#3DBDEC] focus:text-[#3DBDEC]"
            >
              Donations
            </Typography>
          </li>
        </ul>
      </div>
      <hr className="my-8 border-[#3DBDEC]" />
      <Typography
        color="blue-gray"
        className="text-center font-normal text-[#3DBDEC]"
      >
        &copy; FurEver Families
      </Typography>
    </footer>
  );
};

export default Footer;
