/* eslint-disable react/prop-types */
import React, { useContext } from "react";
import {
  ChevronDownIcon,
  Cog6ToothIcon,
  PowerIcon,
  LifebuoyIcon,
} from "@heroicons/react/24/solid";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../../../providers/AuthProvider";
import Swal from "sweetalert2";
import {
  Menu,
  MenuHandler,
  Button,
  MenuList,
  Typography,
  MenuItem,
  Avatar,
} from "@material-tailwind/react";
import useAdmin from "../../../hooks/useAdmin";
import useSeller from "../../../hooks/useSeller";

const Dash_Navbar = ({ title }) => {
  const [isAdmin] = useAdmin();
  const [isSeller] = useSeller();
  const profileMenuItems = [
    {
      label: "Edit Profile",
      icon: Cog6ToothIcon,
      onClick: (navigate) => navigate("/edit-profile"),
    },
    {
      label: "Dashboard",
      icon: LifebuoyIcon,
      onClick: () => {
        if (isAdmin) {
          navigate("/dashboard/adminHome");
        } else if (isSeller) {
          navigate("/dashboard/sellerHome");
        } else {
          navigate("dashboard/user/paymentHistory");
        }
      },
    },
    {
      label: "Sign Out",
      icon: PowerIcon,
      onClick: null, // onClick will be handled by handleLogOut
    },
  ];
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const closeMenu = () => setIsMenuOpen(false);
  const navigate = useNavigate();
  const { user, logOut } = useContext(AuthContext);

  const handleLogOut = () => {
    logOut()
      .then(() => {
        Swal.fire({
          position: "top-end",
          icon: "success",
          title: "You have been logged out",
          showConfirmButton: false,
          timer: 1500,
        }).then(() => {
          navigate("/");
        });
      })
      .catch((e) => {
        console.log(e);
      });
  };

  const handleMenuItemClick = (menuItem) => {
    if (menuItem.onClick) {
      menuItem.onClick(navigate);
    } else if (menuItem.label === "Sign Out") {
      handleLogOut();
    } else {
      closeMenu();
    }
  };

  return (
    <div className="flex items-center justify-between bg-[#1F2B5B] px-5 py-2 rounded-xl mb-5">
      <div>
        <Typography variant="h4" className="text-[#3DBDEC]">
          {isAdmin
            ? `Admin Dashboard / ${title} `
            : isSeller
            ? `Seller Dashboard / ${title} `
            : `User Dashboard / ${title}`}
        </Typography>{" "}
      </div>
      <Menu open={isMenuOpen} handler={setIsMenuOpen} placement="bottom-end">
        <MenuHandler>
          <Button
            variant="text"
            color="blue-gray"
            className="flex items-center gap-1 rounded-full py-0.5 pr-2 pl-0.5 lg:ml-auto"
          >
            <Avatar
              variant="circular"
              size="sm"
              alt={user?.displayName || "User Avatar"}
              className="border border-gray-900 p-0.5"
              src={user?.photoURL || "/path/to/default-avatar.png"} // Provide a default avatar image path
            />
            <ChevronDownIcon
              strokeWidth={2.5}
              className={`h-3 w-3 transition-transform ${
                isMenuOpen ? "rotate-180" : ""
              }`}
            />
          </Button>
        </MenuHandler>
        <MenuList className="p-1">
          {profileMenuItems.map((menuItem, key) => {
            const isLastItem = key === profileMenuItems.length - 1;
            return (
              <MenuItem
                key={menuItem.label}
                onClick={() => handleMenuItemClick(menuItem)}
                className={`flex items-center gap-2 rounded ${
                  isLastItem
                    ? "hover:bg-red-500/10 focus:bg-red-500/10 active:bg-red-500/10"
                    : ""
                }`}
              >
                {React.createElement(menuItem.icon, {
                  className: `h-4 w-4 ${isLastItem ? "text-red-500" : ""}`,
                  strokeWidth: 2,
                })}
                <Typography
                  as="span"
                  variant="medium"
                  className="font-normal"
                  color={isLastItem ? "red" : "inherit"}
                >
                  {menuItem.label}
                </Typography>
              </MenuItem>
            );
          })}
        </MenuList>
      </Menu>
    </div>
  );
};

export default Dash_Navbar;
