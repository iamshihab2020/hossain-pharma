import React from "react";
import {
  Drawer,
  Button,
  IconButton,
  List,
} from "@material-tailwind/react";
import { NavLink } from "react-router-dom";
import Dash_Navlinks from "../Dash_Navlinks/Dash_Navlinks";



const Dashboard_Drawer = () => {
  
  const [open, setOpen] = React.useState(false);
  const openDrawer = () => setOpen(true);
  const closeDrawer = () => setOpen(false);
  


  return (
    <React.Fragment>
      <div className="min-h-screen bg-[#1F2B5B]">
        <Button
          onClick={openDrawer}
          className="text-[#3DBDEC] bg-transparent font-bold p-3"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="size-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5"
            />
          </svg>
        </Button>
      </div>

      <Drawer
        open={open}
        onClose={closeDrawer}
        className="bg-[#1F2B5B] min-h-screen rounded-t-lg"
      >
        <div className="mb-2 flex items-center justify-between p-4">
          <IconButton
            variant="text"
            className="text-[#3DBDEC] font-black text-xl"
            onClick={closeDrawer}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </IconButton>
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
      </Drawer>
    </React.Fragment>
  );
};

export default Dashboard_Drawer;
