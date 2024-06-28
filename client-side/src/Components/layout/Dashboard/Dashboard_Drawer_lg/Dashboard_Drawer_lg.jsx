import React from "react";
import {
  Button,
  List,
} from "@material-tailwind/react";
import { NavLink } from "react-router-dom";
import logo from "../../../../assets/logo.png";
import Dash_Navlinks from "../Dash_Navlinks/Dash_Navlinks"

const Dashboard_Drawer_lg = () => {
  //#1F2B5B
  //#3DBDEC
  return (
    <React.Fragment>
      <div className="bg-[#1F2B5B] min-h-screen rounded-t-lg">
        <div className="mb-2 rounded-lg  border-r border-r-[#1F2B5B]">
          <div className="w-full bg-white py-3 rounded-lg flex items-center justify-center">
            <img src={logo} alt="" className="h-14 rounded-lg" />
          </div>
        </div>
        <List>
          <Dash_Navlinks />
        </List>

        <hr className="border-[#3DBDEC]" />

        <div className="w-48">
          <NavLink to={"/"}>
            <Button
              className="mt-3 ml-5 w-full bg-[#3DBDEC] text-[#1F2B5B] capitalize"
              size="lg"
            >
              Home
            </Button>
          </NavLink>
        </div>
      </div>
    </React.Fragment>
  );
};

export default Dashboard_Drawer_lg;
